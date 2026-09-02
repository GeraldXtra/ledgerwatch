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

/**
 * Live swap execution.
 *
 * Every reusable piece is reused rather than reimplemented: `preflightGas` is
 * the single gas check from Part 2, `unlockWallet` is the single signing path,
 * `recordTx`/`updateTxStatus` are the single transaction record and confirmation
 * system, and every address comes from the chain registry.
 *
 * NOTHING HERE SIGNS WITHOUT THE USER'S PASSWORD, per transaction. Approval and
 * the swap are separate transactions, each confirmed on its own.
 */

/**
 * Everything the review screen needs, with nothing signed and no gas spent.
 * Each blocking condition is returned as a sentence the user can act on.
 */
export async function planSwap({
  chain,
  address,
  tokenIn,
  tokenOut,
  amountIn, // bigint, in tokenIn's decimals
  amountInDisplay, // number, for the caps which are denominated in stablecoin
  slippagePct = 1,
  limitOverrides,
  spentToday = 0,
}) {
  const provider = getProvider(chain.chainId);
  const limits = limitsFor(chain, limitOverrides);

  if (!chain.dex) {
    return { ok: false, reason: "no-dex", blocks: [`${chain.name} has no verified exchange, so trades here are paper only.`] };
  }

  // 1. Do we have the input token at all?
  const inC = new ethers.Contract(tokenIn.address, ERC20_ALLOWANCE_ABI, provider);
  const balance = await inC.balanceOf(address);
  const blocks = [];
  if (balance < amountIn) {
    blocks.push(
      `You hold ${Number(ethers.formatUnits(balance, tokenIn.decimals)).toFixed(4)} ${tokenIn.symbol} and this trade needs ${amountInDisplay}.`
    );
  }

  // 2. Best price across EVERY tier, with impact measured.
  const quote = await bestQuote({ provider, chain, tokenIn: tokenIn.address, tokenOut: tokenOut.address, amountIn });
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

  // 3. Allowance. Approval is a SEPARATE transaction the user approves first.
  const allowance = await inC.allowance(address, chain.dex.router);
  const needsApproval = allowance < amountIn;

  // 4. Gas — the Part 2 preflight, not a second implementation.
  const swapTx = buildSwapTx({
    chain,
    tokenIn: tokenIn.address,
    tokenOut: tokenOut.address,
    fee: quote.fee,
    amountIn,
    amountOutMinimum,
    recipient: address,
  });

  let gas = null;
  if (!needsApproval) {
    // Only meaningful once the router may actually move the tokens; before
    // approval the estimate reverts for a reason that is not about gas.
    gas = await preflightGas({ provider, from: address, tx: swapTx });
    if (!gas.ok) blocks.push(null); // GasNotice renders the detail
  }

  // 5. Would it actually succeed? Catch a failing swap before paying for it.
  let simulation = { ok: true };
  if (!needsApproval && balance >= amountIn) {
    simulation = await simulateSwap({ provider, tx: swapTx, from: address });
    if (!simulation.ok) {
      blocks.push(`The swap would fail: ${simulation.error}`);
    }
  }

  /**
   * 6. Spending caps and the gas floor.
   *
   * THE CAP IS MEASURED IN DOLLARS, SO IT MUST BE GIVEN DOLLARS.
   *
   * This passed `amountInDisplay`, which is the quantity of tokenIn. On a BUY
   * that is the cash token and the cap worked. On a SELL tokenIn is the asset,
   * so a cap of 100 was being compared against a count of Bitcoin: selling 12.8
   * WBTC read as "12.8", passed every limit, and moved roughly 995,000 dollars
   * through a control whose message says 100.
   *
   * The dollar leg is whichever side is the cash token, so that is what is
   * measured. This is the same class of error as LW-008, surviving inside the
   * control built to catch it.
   */
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
    // What this trade is worth in dollars, whichever side the cash is on. The
    // caps and the session spend are both denominated in this.
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

/**
 * Approve the router to move `tokenIn`. A SEPARATE, explicitly confirmed
 * transaction — never bundled into the swap, so the user always knows they are
 * granting an allowance.
 */
export async function approveRouter({ plan, password, onStep = () => {} }) {
  const provider = getProvider(plan.chain.chainId);
  onStep("Unlocking your wallet");
  const master = await unlockWallet(password);
  const signer = master.connect(provider);

  onStep("Approving");
  const c = new ethers.Contract(plan.tokenIn.address, ERC20_ALLOWANCE_ABI, signer);
  // Exactly what this trade needs, not an unlimited allowance: a blanket
  // approval outlives the trade and is a standing risk if the router is ever
  // compromised.
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
  }).catch(() => null);

  onStep("Waiting for the approval to confirm");
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) throw new Error("The approval transaction failed.");
  return tx.hash;
}

/**
 * Sign and broadcast the swap. Requires the password again — approval and swap
 * are two distinct authorisations.
 */
export async function executeSwap({ plan, password, side, alertId, onStep = () => {} }) {
  const provider = getProvider(plan.chain.chainId);
  onStep("Unlocking your wallet");
  const master = await unlockWallet(password);
  const signer = master.connect(provider);

  onStep("Signing");
  const txResp = await signer.sendTransaction(plan.swapTx);

  const amountOutDisplay = ethers.formatUnits(plan.quote.amountOut, plan.tokenOut.decimals);

  // ONE record, in the same system as every other wallet transaction, so the
  // existing reconciliation loop confirms it and the existing per-chain explorer
  // link works with no new code.
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
    priceImpactPct: Number(plan.quote.impactPct.toFixed(4)),
    side,
    alertId: alertId || null,
  }).catch(() => null);

  // In dollars, for the same reason the cap is. Charging a session budget of 150
  // with "12.8" for a 995,000 dollar sale made the session cap meaningless too.
  recordSessionSpend(plan.cashValueDisplay ?? plan.amountInDisplay);

  // Settle in the background exactly as SendForm and sweep do — a testnet
  // confirmation takes 10-30s and must not hold the UI.
  if (record && record._id) {
    txResp
      .wait()
      .then((r) => updateTxStatus(record._id, r && r.status === 1 ? "confirmed" : "failed"))
      .catch(() => {});
  }

  return { txHash: txResp.hash, amountOut: amountOutDisplay, feeTier: plan.quote.fee };
}
