import { ethers } from "ethers";
import { getProvider } from "../provider";
import { preflightGas } from "../gas";
import { checkTrade, limitsFor } from "../guardrails";
import { stableUsdPrice } from "../usdValue";
import {
  ERC20_ALLOWANCE_ABI,
  bestQuote,
  buildSwapTx,
  buildUnwrapTx,
  buildWrapTx,
  minOut,
  simulateSwap,
} from "../../market/dex";
import { describeTradeSafety, isVerifiedToken, simulateTrade } from "../../market/tradeSimulation";
import { isCashToken } from "../../market/tradeability";
import { isWrappedNative, sameAsset } from "./assets";

export function toUnits(amountDisplay, decimals) {
  const n = Number(amountDisplay);
  if (!Number.isFinite(n) || n <= 0) throw new Error("Enter an amount greater than zero.");
  const places = Math.max(0, Math.min(Number(decimals) || 0, 100));
  let s = String(n);
  if (/e/i.test(s)) s = n.toFixed(Math.min(places + 2, 100));
  const [whole, frac = ""] = s.split(".");
  const truncated = frac.slice(0, places);
  return ethers.parseUnits(truncated ? `${whole}.${truncated}` : whole, decimals);
}

export function swapKind(chain, from, to) {
  if (!from || !to) return null;
  if (sameAsset(from, to)) return "same";
  if (from.native && isWrappedNative(chain, to)) return "wrap";
  if (to.native && isWrappedNative(chain, from)) return "unwrap";
  return "swap";
}

function units(amount, asset) {
  return `${Number(ethers.formatUnits(amount, asset.decimals)).toFixed(6)} ${asset.symbol}`;
}

function usdValueOf({ from, to, amountInDisplay, amountOutDisplay, usdPriceFor }) {
  const priceFor = (symbol) => {
    const stable = stableUsdPrice(symbol);
    if (stable != null) return stable;
    const p = usdPriceFor ? Number(usdPriceFor(symbol)) : NaN;
    return Number.isFinite(p) && p > 0 ? p : null;
  };
  if (isCashToken(from)) return { usd: Number(amountInDisplay), basis: from.symbol };
  if (to && isCashToken(to) && amountOutDisplay != null) return { usd: Number(amountOutDisplay), basis: to.symbol };
  const pIn = priceFor(from.symbol);
  if (pIn != null) return { usd: Number(amountInDisplay) * pIn, basis: from.symbol };
  const pOut = to && amountOutDisplay != null ? priceFor(to.symbol) : null;
  if (pOut != null) return { usd: Number(amountOutDisplay) * pOut, basis: to.symbol };
  return { usd: null, basis: null };
}

function unvalued(from, to) {
  return (
    `Neither ${from.symbol} nor ${to.symbol} has a dollar price right now, so this swap cannot be checked ` +
    "against your trading limits, and it was not offered. Try again when prices are back."
  );
}

async function balanceOf({ provider, address, asset }) {
  if (asset.native) return provider.getBalance(address);
  const c = new ethers.Contract(asset.address, ERC20_ALLOWANCE_ABI, provider);
  return c.balanceOf(address);
}

async function planWrapOrUnwrap({ kind, chain, address, from, to, amountIn, amountInDisplay, limits, spentToday, usdPriceFor, balance }) {
  const provider = getProvider(chain.chainId);
  const blocks = [];
  if (balance < amountIn) blocks.push(`You hold ${units(balance, from)} and this needs ${amountInDisplay} ${from.symbol}.`);
  const tx = kind === "wrap" ? buildWrapTx({ chain, amount: amountIn }) : buildUnwrapTx({ chain, amount: amountIn });
  const gas = await preflightGas({ provider, from: address, tx: { to: tx.to, data: tx.data, value: tx.value }, valueWei: tx.value || 0n });
  if (!gas.ok) blocks.push(null);
  const valued = usdValueOf({ from, to, amountInDisplay, amountOutDisplay: Number(amountInDisplay), usdPriceFor });
  let caps = { ok: false, blocks: [], warnings: [], needsExtraConfirm: false };
  if (valued.usd == null) blocks.push(unvalued(from, to));
  else {
    const nativeAfterWei = gas.balanceWei - gas.feeWei - (kind === "wrap" ? amountIn : 0n);
    caps = checkTrade({ amount: valued.usd, limits, spentToday, impactPct: 0, nativeAfterWei });
  }
  const label = kind === "wrap" ? `Wrap ${from.symbol} into ${to.symbol}` : `Unwrap ${from.symbol} into ${to.symbol}`;
  return {
    ok: blocks.filter(Boolean).length === 0 && caps.ok && gas.ok,
    kind,
    label,
    chain,
    side: null,
    from,
    to,
    tokenIn: from,
    tokenOut: to,
    amountIn,
    amountInDisplay,
    amountOutDisplay: Number(amountInDisplay),
    cashValueDisplay: valued.usd,
    cashBasis: valued.basis,
    quote: { amountOut: amountIn, fee: 0, fees: [], via: null, impactPct: 0, alternatives: 1, route: null },
    amountOutMinimum: amountIn,
    slippagePct: 0,
    needsApproval: false,
    allowance: 0n,
    gas,
    swapTx: tx,
    simulation: { ok: gas.ok && !gas.reverted },
    safety: null,
    needsSafetyAck: false,
    needsAllowanceReset: false,
    limits,
    blocks: [...blocks.filter(Boolean), ...caps.blocks],
    warnings: caps.warnings,
    needsExtraConfirm: false,
    routeLabel: `${from.symbol} > ${to.symbol} (${kind})`,
  };
}

export async function planEvmSwap({
  chain,
  address,
  from,
  to,
  amountIn,
  amountInDisplay,
  slippagePct = 1,
  limitOverrides,
  spentToday = 0,
  usdPriceFor,
}) {
  const kind = swapKind(chain, from, to);
  if (kind === "same") return { ok: false, reason: "same-asset", blocks: ["Pick two different assets."] };
  if (!kind) return { ok: false, reason: "no-assets", blocks: ["Pick what to pay and what to receive."] };

  const provider = getProvider(chain.chainId);
  const limits = limitsFor(chain, limitOverrides);
  const balance = await balanceOf({ provider, address, asset: from });

  if (kind === "wrap" || kind === "unwrap") {
    return planWrapOrUnwrap({ kind, chain, address, from, to, amountIn, amountInDisplay, limits, spentToday, usdPriceFor, balance });
  }

  if (!chain.dex) {
    return { ok: false, reason: "no-dex", blocks: [`${chain.name} has no verified exchange, so nothing can be swapped here.`] };
  }
  const wrapped = chain.wrappedNative;
  if ((from.native || to.native) && !(wrapped && wrapped.address)) {
    return {
      ok: false,
      reason: "no-wrapped",
      blocks: [`${chain.name} has no verified wrapped ${chain.nativeSymbol}, so its native coin cannot be swapped here.`],
    };
  }

  const routeIn = from.native ? { ...wrapped, native: false } : from;
  const routeOut = to.native ? { ...wrapped, native: false } : to;

  const blocks = [];
  if (balance < amountIn) blocks.push(`You hold ${units(balance, from)} and this swap needs ${amountInDisplay} ${from.symbol}.`);

  const quote = await bestQuote({ provider, chain, tokenIn: routeIn.address, tokenOut: routeOut.address, amountIn });

  if (quote && quote.incomplete) {
    return {
      ok: false,
      reason: "incomplete-quote",
      blocks: [
        `Only ${quote.priced} of ${quote.total} price routes on ${chain.name} could be checked just now, ` +
          "so this is not necessarily the best price and it was not offered. The network is busy rather " +
          "than broken. Try again in a few seconds.",
      ],
    };
  }
  if (quote && quote.unmeasurable) {
    return {
      ok: false,
      reason: "amount-too-small",
      blocks: [
        `This amount is too small to price safely: it is under a thousand of ${from.symbol}'s smallest units, ` +
          "so there is no price impact figure for it. Enter a larger amount.",
      ],
    };
  }
  if (!quote) {
    return {
      ok: false,
      reason: "no-pool",
      blocks: [`There is no ${from.symbol}/${to.symbol} pool with liquidity on ${chain.name}, so this pair cannot be swapped here.`],
    };
  }

  const amountOutMinimum = minOut(quote.amountOut, slippagePct);

  let allowance = 0n;
  let needsApproval = false;
  if (!from.native) {
    const inC = new ethers.Contract(from.address, ERC20_ALLOWANCE_ABI, provider);
    allowance = await inC.allowance(address, chain.dex.router);
    needsApproval = allowance < amountIn;
  }

  const swapTx = buildSwapTx({
    chain,
    quote,
    amountIn,
    amountOutMinimum,
    recipient: address,
    tokenIn: routeIn.address,
    tokenOut: routeOut.address,
    nativeIn: Boolean(from.native),
    nativeOut: Boolean(to.native),
  });

  let gas = null;
  if (!needsApproval) {
    gas = await preflightGas({
      provider,
      from: address,
      tx: { to: swapTx.to, data: swapTx.data, value: swapTx.value },
      valueWei: swapTx.value || 0n,
    });
    if (!gas.ok) blocks.push(null);
  }

  const outVerified = isVerifiedToken(chain, routeOut);
  let simulation = { ok: true };
  let safety = null;
  if (balance >= amountIn) {
    if (to.native) {
      if (!needsApproval) {
        simulation = await simulateSwap({ provider, tx: swapTx, from: address });
        if (!simulation.ok) blocks.push(`The swap would fail: ${simulation.error}`);
      }
    } else {
      safety = await simulateTrade({
        provider,
        chain,
        from: address,
        tokenIn: routeIn,
        tokenOut: routeOut,
        amountIn,
        amountOutMinimum,
        swapTx,
        quote,
        needsApproval,
        sellBack: !outVerified,
      });
      if (safety.checked) {
        simulation = { ok: safety.ok };
      } else if (!needsApproval) {
        simulation = await simulateSwap({ provider, tx: swapTx, from: address });
        if (!simulation.ok) blocks.push(`The swap would fail: ${simulation.error}`);
      }
    }
  }

  const verdict = describeTradeSafety({
    safety,
    side: outVerified ? "sell" : "buy",
    chain,
    tokenIn: routeIn,
    tokenOut: routeOut,
    amountOutMinimum,
    needsApproval,
    allowance,
  });
  blocks.push(...verdict.blocks);

  const amountOutDisplay = Number(ethers.formatUnits(quote.amountOut, routeOut.decimals));
  const valued = usdValueOf({ from, to, amountInDisplay: Number(amountInDisplay), amountOutDisplay, usdPriceFor });
  let caps = { ok: false, blocks: [], warnings: [], needsExtraConfirm: false };
  if (valued.usd == null) blocks.push(unvalued(from, to));
  else {
    const nativeSpend = from.native ? amountIn : 0n;
    const nativeAfterWei = gas ? gas.balanceWei - gas.feeWei - nativeSpend : null;
    caps = checkTrade({ amount: valued.usd, limits, spentToday, impactPct: quote.impactPct, nativeAfterWei });
  }

  const routeLabel = quote.via
    ? `${from.symbol} > ${quote.via} > ${to.symbol} (${quote.fees.join("/")})`
    : `${from.symbol} > ${to.symbol} (${quote.fee})`;

  return {
    ok: blocks.filter(Boolean).length === 0 && caps.ok && (needsApproval || (gas && gas.ok)),
    kind: "swap",
    label: `Swap ${from.symbol} for ${to.symbol}`,
    chain,
    side: null,
    from,
    to,
    tokenIn: from,
    tokenOut: to,
    routeIn,
    routeOut,
    amountIn,
    amountInDisplay,
    amountOutDisplay,
    cashValueDisplay: valued.usd,
    cashBasis: valued.basis,
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
    routeLabel,
  };
}
