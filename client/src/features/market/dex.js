import { ethers } from "ethers";

/**
 * Uniswap V3 quoting and swap encoding.
 *
 * EVERY ADDRESS COMES FROM THE CHAIN REGISTRY. Nothing here hardcodes a router,
 * quoter or token — the registry is the single verified source, and a chain
 * without a `dex` entry simply cannot be traded on.
 *
 * The PROVIDER IS PASSED IN rather than imported. This module then depends on
 * nothing but ethers, so it can be exercised directly against a real chain in a
 * test without dragging in auth, axios or Vite's env.
 */

// QuoterV2. `quoteExactInputSingle` is non-view in the ABI but is designed to be
// called with eth_call, which is what a staticCall does.
const QUOTER_ABI = [
  "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)",
];

const ROUTER_ABI = [
  "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)",
];

export const ERC20_ALLOWANCE_ABI = [
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
];

/**
 * The reference size used to establish an "unimpacted" rate. Small enough that
 * it barely moves any pool, so the difference against the real size IS the
 * price impact.
 */
const DUST_DIVISOR = 1000n;

/** One tier's quote, or null when that pool cannot fill the trade. */
async function quoteTier({ provider, quoter, tokenIn, tokenOut, amountIn, fee }) {
  try {
    const c = new ethers.Contract(quoter, QUOTER_ABI, provider);
    const res = await c.quoteExactInputSingle.staticCall({
      tokenIn,
      tokenOut,
      amountIn,
      fee,
      sqrtPriceLimitX96: 0n,
    });
    const amountOut = res[0] ?? res.amountOut;
    if (!amountOut || amountOut === 0n) return null;
    return { fee, amountOut, gasEstimate: res[3] ?? null };
  } catch {
    // A revert means no pool at this tier, or not enough liquidity to fill.
    // That is ordinary and expected, not an error worth surfacing.
    return null;
  }
}

/**
 * Quote EVERY configured fee tier and return them all, best first.
 *
 * Quoting a single tier is not a shortcut, it is a bug: on Base Sepolia the
 * 0.05% pool prices WETH at 531 USDC and the 0.3% pool at 3,189. Taking the
 * first tier that answers would have used a price six times wrong.
 */
export async function quoteAllTiers({ provider, chain, tokenIn, tokenOut, amountIn }) {
  if (!chain?.dex?.quoter) return [];
  const tiers = chain.dex.feeTiers || [500, 3000, 10000];

  const quotes = await Promise.all(
    tiers.map((fee) =>
      quoteTier({ provider, quoter: chain.dex.quoter, tokenIn, tokenOut, amountIn, fee })
    )
  );
  return quotes.filter(Boolean).sort((a, b) => (b.amountOut > a.amountOut ? 1 : -1));
}

/**
 * Best quote for a trade, with its price impact measured against a dust-sized
 * reference through the SAME pool.
 *
 * @returns {Promise<null|{fee:number, amountOut:bigint, impactPct:number, alternatives:number}>}
 */
export async function bestQuote({ provider, chain, tokenIn, tokenOut, amountIn }) {
  const quotes = await quoteAllTiers({ provider, chain, tokenIn, tokenOut, amountIn });
  if (!quotes.length) return null;

  const best = quotes[0];

  // Reference rate from a trade small enough not to move the pool.
  const dust = amountIn / DUST_DIVISOR;
  let impactPct = 0;
  if (dust > 0n) {
    const ref = await quoteTier({
      provider,
      quoter: chain.dex.quoter,
      tokenIn,
      tokenOut,
      amountIn: dust,
      fee: best.fee,
    });
    if (ref) {
      // Rates as floats only for the ratio — both sides are scaled identically,
      // so the division is safe and the result is a percentage.
      const refRate = Number(ref.amountOut) / Number(dust);
      const realRate = Number(best.amountOut) / Number(amountIn);
      if (refRate > 0) impactPct = Math.max(0, ((refRate - realRate) / refRate) * 100);
    }
  }

  return {
    fee: best.fee,
    amountOut: best.amountOut,
    impactPct,
    alternatives: quotes.length,
  };
}

/** Encoded `exactInputSingle` call, ready to estimate, simulate or sign. */
export function buildSwapTx({ chain, tokenIn, tokenOut, fee, amountIn, amountOutMinimum, recipient }) {
  const iface = new ethers.Interface(ROUTER_ABI);
  return {
    to: chain.dex.router,
    data: iface.encodeFunctionData("exactInputSingle", [
      {
        tokenIn,
        tokenOut,
        fee,
        recipient,
        amountIn,
        amountOutMinimum,
        sqrtPriceLimitX96: 0n,
      },
    ]),
  };
}

/** Minimum received after slippage, as the router's `amountOutMinimum`. */
export function minOut(amountOut, slippagePct) {
  const bps = BigInt(Math.round(Math.max(0, Math.min(50, slippagePct)) * 100));
  return (amountOut * (10000n - bps)) / 10000n;
}

/** Current router allowance for a token. */
export async function allowanceFor({ provider, chain, token, owner }) {
  const c = new ethers.Contract(token, ERC20_ALLOWANCE_ABI, provider);
  return c.allowance(owner, chain.dex.router);
}

/**
 * Simulate the swap before a single unit of gas is spent. A revert here is the
 * difference between finding out now and paying for a failed transaction.
 */
export async function simulateSwap({ provider, tx, from }) {
  try {
    await provider.call({ ...tx, from });
    return { ok: true };
  } catch (err) {
    const msg = err?.shortMessage || err?.reason || err?.message || "The swap would fail.";
    return { ok: false, error: msg };
  }
}
