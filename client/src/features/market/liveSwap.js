import { ethers } from "ethers";
import { getProvider } from "../wallet/provider";
import { unlockWallet } from "../wallet/keystore";
import { preflightGas } from "../wallet/gas";
import { recordTx, updateTxStatus } from "../wallet/walletApi";
import { checkTrade, limitsFor, recordSessionSpend } from "../wallet/guardrails";
import {
  ERC20_ALLOWANCE_ABI,
  bestQuote,
  buildSwapTx,
  minOut,
  simulateSwap,
} from "./dex";
import { isCashToken } from "./tradeability";

export async function planSwap({
  chain,
  address,
  tokenIn,
  tokenOut,
  amountIn,
  amountInDisplay,
  slippagePct = 1,
  limitOverrides,
  spentToday = 0,
}) {
  const provider = getProvider(chain.chainId);
  const limits = limitsFor(chain, limitOverrides);

  if (!chain.dex) {
    return { ok: false, reason: "no-dex", blocks: [`${chain.name} has no verified exchange, so trades here are paper only.`] };
  }

  const inC = new ethers.Contract(tokenIn.address, ERC20_ALLOWANCE_ABI, provider);
  const balance = await inC.balanceOf(address);
  const blocks = [];
  if (balance < amountIn) {
    blocks.push(
      `You hold ${Number(ethers.formatUnits(balance, tokenIn.decimals)).toFixed(4)} ${tokenIn.symbol} and this trade needs ${amountInDisplay}.`
    );
  }

  const quote = await bestQuote({ provider, chain, tokenIn: tokenIn.address, tokenOut: tokenOut.address, amountIn });

  if (quote && quote.incomplete) {
    return {
      ok: false,
      reason: "incomplete-quote",
      blocks: [
        `Only ${quote.priced} of ${quote.total} price routes on ${chain.name} could be checked just now, ` +
          `so this is not necessarily the best price and it was not offered. The network is busy rather ` +
          `than broken. Try again in a few seconds.`,
      ],
    };
  }

  if (quote && quote.unmeasurable) {
    return {
      ok: false,
      reason: "amount-too-small",
      blocks: [
        `This amount is too small to price safely: it is under a thousand of ${tokenIn.symbol}'s ` +
          `smallest units, which is less than the reference trade the price impact is measured ` +
          `against, so there is no impact figure for it. Enter a larger amount.`,
      ],
    };
  }

  if (!quote) {
    return {
      ok: false,
      reason: "no-pool",
      blocks: [
        `There is no ${tokenIn.symbol}/${tokenOut.symbol} pool with liquidity on ${chain.name}, so this pair cannot be traded live here.`,
      ],
    };
  }

  const amountOutMinimum = minOut(quote.amountOut, slippagePct);

  const allowance = await inC.allowance(address, chain.dex.router);
  const needsApproval = allowance < amountIn;

  const swapTx = buildSwapTx({
    chain,
    quote,
    amountIn,
    amountOutMinimum,
    recipient: address,
    tokenIn: tokenIn.address,
    tokenOut: tokenOut.address,
  });

  let gas = null;
  if (!needsApproval) {
    gas = await preflightGas({ provider, from: address, tx: swapTx });
    if (!gas.ok) blocks.push(null);
  }

  let simulation = { ok: true };
  if (!needsApproval && balance >= amountIn) {
    simulation = await simulateSwap({ provider, tx: swapTx, from: address });
    if (!simulation.ok) {
      blocks.push(`The swap would fail: ${simulation.error}`);
    }
  }

  const sellingForCash = isCashToken(tokenOut);
  const cashValueDisplay = sellingForCash
    ? Number(ethers.formatUnits(quote.amountOut, tokenOut.decimals))
    : Number(amountInDisplay);

  const nativeAfterWei = gas ? gas.balanceWei - gas.feeWei : null;
  const caps = checkTrade({
    amount: cashValueDisplay,
    limits,
    spentToday,
    impactPct: quote.impactPct,
    nativeAfterWei,
  });

  return {
    ok: blocks.filter(Boolean).length === 0 && caps.ok && (needsApproval || (gas && gas.ok)),
    chain,
    tokenIn,
    tokenOut,
    amountIn,
    amountInDisplay,
    cashValueDisplay,
    quote,
    amountOutMinimum,
    slippagePct,
    needsApproval,
    allowance,
    gas,
    swapTx,
    simulation,
    limits,
    blocks: [...blocks.filter(Boolean), ...caps.blocks],
    warnings: caps.warnings,
    needsExtraConfirm: caps.needsExtraConfirm,
  };
}

export async function approveRouter({ plan, password, onStep = () => {} }) {
  const provider = getProvider(plan.chain.chainId);
  onStep("Unlocking your wallet");
  const master = await unlockWallet(password);
  const signer = master.connect(provider);

  onStep("Approving");
  const c = new ethers.Contract(plan.tokenIn.address, ERC20_ALLOWANCE_ABI, signer);
  const tx = await c.approve(plan.chain.dex.router, plan.amountIn);

  await recordTx({
    chainId: plan.chain.chainId,
    hash: tx.hash,
    from: master.address,
    to: plan.tokenIn.address,
    value: plan.amountInDisplay != null ? String(plan.amountInDisplay) : "0",
    symbol: plan.tokenIn.symbol,
    tokenAddress: plan.tokenIn.address,
    direction: "out",
    kind: "approval",
  }).catch((err) => {
    console.error("[liveSwap] the approval is on chain but was not recorded:", err && err.message);
    return null;
  });

  onStep("Waiting for the approval to confirm");
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) throw new Error("The approval transaction failed.");
  return tx.hash;
}

const DEADLINE_MARGIN_SECONDS = 45;

function planExpired(plan) {
  const deadline = plan && plan.swapTx && plan.swapTx.deadline;
  if (deadline == null) return false;
  return Number(deadline) - Math.floor(Date.now() / 1000) < DEADLINE_MARGIN_SECONDS;
}

export async function executeSwap({ plan, password, side, alertId, onStep = () => {} }) {
  if (planExpired(plan)) {
    throw new Error(
      "This quote has expired, so it was not signed. Get a fresh quote and review it again."
    );
  }
  const provider = getProvider(plan.chain.chainId);
  onStep("Unlocking your wallet");
  const master = await unlockWallet(password);
  const signer = master.connect(provider);

  onStep("Signing");
  const txResp = await signer.sendTransaction(plan.swapTx);

  const amountOutDisplay = ethers.formatUnits(plan.quote.amountOut, plan.tokenOut.decimals);

  let recorded = true;
  const record = await recordTx({
    chainId: plan.chain.chainId,
    hash: txResp.hash,
    from: master.address,
    to: plan.chain.dex.router,
    value: String(plan.amountInDisplay),
    symbol: plan.tokenIn.symbol,
    tokenAddress: plan.tokenIn.address,
    direction: "out",
    kind: "swap",
    tokenOut: plan.tokenOut.address,
    tokenOutSymbol: plan.tokenOut.symbol,
    amountOut: amountOutDisplay,
    minAmountOut: ethers.formatUnits(plan.amountOutMinimum, plan.tokenOut.decimals),
    feeTier: plan.quote.fee,
    route: plan.quote.via
      ? `${plan.tokenIn.symbol} > ${plan.quote.via} > ${plan.tokenOut.symbol} (${plan.quote.fees.join("/")})`
      : `${plan.tokenIn.symbol} > ${plan.tokenOut.symbol} (${plan.quote.fee})`,
    priceImpactPct: Number(plan.quote.impactPct.toFixed(4)),
    side,
    alertId: alertId || null,
  }).catch((err) => {
    recorded = false;
    console.error("[liveSwap] the swap is on chain but was not recorded:", err && err.message);
    return null;
  });

  recordSessionSpend(plan.cashValueDisplay ?? plan.amountInDisplay);

  if (record && record._id) {
    txResp
      .wait()
      .then((r) => updateTxStatus(record._id, r && r.status === 1 ? "confirmed" : "failed"))
      .catch(() => {});
  }

  return {
    txHash: txResp.hash,
    amountOut: amountOutDisplay,
    feeTier: plan.quote.fee,
    recorded,
  };
}
