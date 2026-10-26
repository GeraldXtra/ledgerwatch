import { ethers } from "ethers";
import { getProvider } from "../wallet/provider";
import { unlockWallet } from "../wallet/keystore";
import { preflightGas } from "../wallet/gas";
import { recordTx, updateTxStatus } from "../wallet/walletApi";
import { checkTrade, limitsFor, recordSessionSpend } from "../wallet/guardrails";
import { broadcastSigned, signForBroadcast, trackConfirmation } from "../wallet/broadcast";
import {
  ERC20_ALLOWANCE_ABI,
  bestQuote,
  buildSwapTx,
  minOut,
  simulateSwap,
} from "./dex";
import { describeTradeSafety, simulateTrade } from "./tradeSimulation";
import { isCashToken } from "./tradeability";

export async function planSwap({
  chain,
  address,
  side,
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
  const tradeSide = side || (isCashToken(tokenIn) && !isCashToken(tokenOut) ? "buy" : "sell");

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
  let safety = null;
  if (balance >= amountIn) {
    safety = await simulateTrade({
      provider,
      chain,
      from: address,
      tokenIn,
      tokenOut,
      amountIn,
      amountOutMinimum,
      swapTx,
      quote,
      needsApproval,
      sellBack: tradeSide === "buy",
    });
    if (safety.checked) {
      simulation = { ok: safety.ok };
    } else if (!needsApproval) {
      simulation = await simulateSwap({ provider, tx: swapTx, from: address });
      if (!simulation.ok) {
        blocks.push(`The swap would fail: ${simulation.error}`);
      }
    }
  }

  const verdict = describeTradeSafety({
    safety,
    side: tradeSide,
    chain,
    tokenIn,
    tokenOut,
    amountOutMinimum,
    needsApproval,
    allowance,
  });
  blocks.push(...verdict.blocks);

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
    side: tradeSide,
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
    safety,
    needsSafetyAck: verdict.needsAck,
    needsAllowanceReset: Boolean(
      needsApproval && allowance > 0n && safety && safety.checked && safety.kind === "approval-fails"
    ),
    limits,
    blocks: [...blocks.filter(Boolean), ...caps.blocks],
    warnings: [...verdict.warnings, ...caps.warnings],
    needsExtraConfirm: caps.needsExtraConfirm,
  };
}

export async function approveRouter({ plan, password, reset = false, onStep = () => {} }) {
  const provider = getProvider(plan.chain.chainId);
  onStep("Unlocking your wallet");
  const master = await unlockWallet(password);
  const signer = master.connect(provider);

  onStep(reset ? "Resetting the allowance" : "Approving");
  const c = new ethers.Contract(plan.tokenIn.address, ERC20_ALLOWANCE_ABI, signer);
  const tx = await c.approve(plan.chain.dex.router, reset ? 0n : plan.amountIn);

  const recorded = await recordTx({
    chainId: plan.chain.chainId,
    hash: tx.hash,
    from: master.address,
    to: plan.tokenIn.address,
    value: reset ? "0" : plan.amountInDisplay != null ? String(plan.amountInDisplay) : "0",
    symbol: plan.tokenIn.symbol,
    tokenAddress: plan.tokenIn.address,
    direction: "out",
    kind: "approval",
  })
    .then((row) => Boolean(row && row._id))
    .catch((err) => {
      console.error("[liveSwap] the approval is on chain but was not recorded:", err && err.message);
      return false;
    });

  onStep(reset ? "Waiting for the reset to confirm" : "Waiting for the approval to confirm");
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) {
    throw new Error(reset ? "The allowance reset failed." : "The approval transaction failed.");
  }
  return { hash: tx.hash, recorded };
}

const DEADLINE_MARGIN_SECONDS = 45;

const TRACKING_MARGIN_MS = 10 * 60 * 1000;

const LIMIT_CODES = new Set(["daily_limit", "trade_limit", "unpriced_swap"]);

const EXPIRED =
  "This quote has expired, so it was not signed. Get a fresh quote and review it again.";

function planExpired(plan) {
  const deadline = plan && plan.swapTx && plan.swapTx.deadline;
  if (deadline == null) return false;
  return Number(deadline) - Math.floor(Date.now() / 1000) < DEADLINE_MARGIN_SECONDS;
}

function trackingWindowMs(plan) {
  const deadline = plan && plan.swapTx && plan.swapTx.deadline;
  const left = deadline == null ? 0 : Number(deadline) * 1000 - Date.now();
  return Math.max(60 * 1000, left + TRACKING_MARGIN_MS);
}

function serverReason(err) {
  return (err && err.response && err.response.data && err.response.data.error) || (err && err.message) || "";
}

export async function executeSwap({ plan, password, side, alertId, onStep = () => {} }) {
  if (planExpired(plan)) throw new Error(EXPIRED);

  const provider = getProvider(plan.chain.chainId);
  onStep("Unlocking your wallet");
  const master = await unlockWallet(password);
  const signer = master.connect(provider);

  onStep("Signing");
  const { signed, hash } = await signForBroadcast(signer, {
    to: plan.swapTx.to,
    data: plan.swapTx.data,
    value: plan.swapTx.value || 0n,
  });
  if (planExpired(plan)) throw new Error(EXPIRED);

  const amountOutDisplay = ethers.formatUnits(plan.quote.amountOut, plan.tokenOut.decimals);

  onStep("Saving it to your history");
  let record = null;
  let recordError = "";
  try {
    record = await recordTx({
      chainId: plan.chain.chainId,
      hash,
      from: master.address,
      to: plan.swapTx.to,
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
      route:
        plan.routeLabel ||
        (plan.quote.via
          ? `${plan.tokenIn.symbol} > ${plan.quote.via} > ${plan.tokenOut.symbol} (${plan.quote.fees.join("/")})`
          : `${plan.tokenIn.symbol} > ${plan.tokenOut.symbol} (${plan.quote.fee})`),
      priceImpactPct: Number(plan.quote.impactPct.toFixed(4)),
      side,
      alertId: alertId || null,
    });
  } catch (err) {
    recordError = serverReason(err);
    const code = err && err.response && err.response.data && err.response.data.code;
    if (LIMIT_CODES.has(code)) {
      throw new Error(`This swap was not sent: ${recordError} Nothing left your wallet.`);
    }
  }
  if (!record || !record._id) {
    throw new Error(
      "This swap was signed but not sent, because it could not be saved to your history first, and an " +
        "unsaved swap would not count towards your daily limit. Nothing left your wallet. Try again in a " +
        "moment." +
        (recordError ? ` (${recordError})` : "")
    );
  }

  onStep("Sending");
  const sent = await broadcastSigned(provider, signed);

  if (sent.outcome === "refused") {
    const marked = await updateTxStatus(record._id, "failed")
      .then(() => true)
      .catch(() => false);
    throw new Error(
      `The network refused this swap, so nothing left your wallet: ${sent.reason}.` +
        (marked ? "" : " It may show as pending in your history until the chain is checked again.")
    );
  }

  recordSessionSpend(plan.cashValueDisplay ?? plan.amountInDisplay);

  trackConfirmation({
    provider,
    hash,
    response: sent.response,
    timeoutMs: trackingWindowMs(plan),
    onSettled: (status) => updateTxStatus(record._id, status),
  });

  return {
    txHash: hash,
    amountOut: amountOutDisplay,
    feeTier: plan.quote.fee,
    broadcast: sent.outcome === "accepted" ? "sent" : "unknown",
    broadcastReason: sent.outcome === "accepted" ? null : sent.reason,
  };
}
