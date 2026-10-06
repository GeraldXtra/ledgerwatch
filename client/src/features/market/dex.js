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

// QuoterV2. Both entry points are non-view in the ABI but are designed to be
// called with eth_call, which is what a staticCall does.
const QUOTER_ABI = [
  "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)",
  // The MULTI-HOP quote. Takes an encoded path rather than a pair, so one call
  // prices a route through an intermediate token. See ROUTES below for why this
  // is not an optional refinement.
  "function quoteExactInput(bytes path, uint256 amountIn) returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)",
];

const ROUTER_ABI = [
  "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)",
  // The multi-hop swap, matching quoteExactInput. Note there is no
  // sqrtPriceLimitX96 and no fee: both live inside the encoded path.
  "function exactInput((bytes path,address recipient,uint256 amountIn,uint256 amountOutMinimum)) payable returns (uint256 amountOut)",
  // SwapRouter02's deadline-carrying multicall. See buildSwapTx.
  "function multicall(uint256 deadline, bytes[] data) payable returns (bytes[] results)",
];

/**
 * How long a signed swap stays valid, in seconds.
 *
 * Twenty minutes is the Uniswap interface default and is the right order: long
 * enough that a briefly congested mempool does not waste the user's gas, short
 * enough that the price they agreed to is still roughly the price they get.
 */
const DEADLINE_SECONDS = Number(import.meta.env?.VITE_SWAP_DEADLINE_SECONDS) || 1200;

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

/**
 * ROUTES, AND WHY A DIRECT QUOTE IS NOT GOOD ENOUGH.
 *
 * This module used to quote ONE pair — the token being bought against the
 * dollar funding the trade — across the four fee tiers, and take the best. That
 * is correct only for assets that happen to have a deep pool against a
 * stablecoin, which is roughly the dozen assets the registry used to carry.
 *
 * MEASURED ON ETHEREUM, 1,000 USDC, against the live chain:
 *
 *   PEPE   direct 132,499,302   via WETH 275,538,619   the hop pays 2.08x
 *   SHIB   direct 102,858,254   via WETH 180,931,591   the hop pays 1.76x
 *   LINK   direct        74.35  via WETH        74.63  the hop pays 1.004x
 *   cbBTC (Base) direct 0.012597  via WETH 0.012592    DIRECT wins
 *
 * So this is not a fallback for tokens with no pool. Quoting only the direct
 * pair would have handed a PEPE buyer less than half of what the market was
 * offering, with no error, no warning, and a transaction that succeeds. Most
 * tokens are paired against the chain's wrapped native rather than against a
 * dollar, because that is where the liquidity providers are; the thin direct
 * pool exists, answers, and prices badly.
 *
 * cbBTC is the reason both are always compared rather than preferring the hop:
 * an extra hop costs an extra pool fee, so on a pair with real direct depth the
 * direct route genuinely wins. The best of both is the only correct answer.
 *
 * The candidate set is bounded on purpose. Every tier on both legs would be
 * sixteen quotes per hop route; each quote is an eth_call through the proxy,
 * and the server caps itself at six upstream connections. The legs below are
 * the tiers real liquidity actually sits in: stable/native pools are 0.05% or
 * 0.3%, and a long-tail token against the native is 0.3% or 1%.
 */
const HOP_IN_TIERS = [500, 3000];
const HOP_OUT_TIERS = [500, 3000, 10000];

/**
 * Uniswap V3 path encoding: token (20 bytes) | fee (3 bytes) | token | fee | token.
 * Addresses are lowercased and stripped of their prefix; the fee is big-endian
 * in exactly three bytes, which is what `uint24` means on the wire.
 */
export function encodePath(tokens, fees) {
  if (tokens.length !== fees.length + 1) {
    throw new Error("A path needs exactly one fee between each pair of tokens.");
  }
  let hex = "0x";
  for (let i = 0; i < tokens.length; i++) {
    hex += String(tokens[i]).slice(2).toLowerCase();
    if (i < fees.length) hex += fees[i].toString(16).padStart(6, "0");
  }
  return hex;
}

/**
 * Quote ONE route. A revert means that route does not exist or cannot fill the
 * trade, which is ordinary and expected — most candidate routes do not exist —
 * so it returns null rather than throwing.
 *
 * @param {{tokens:string[], fees:number[]}} route
 * @returns {Promise<null|{route:object, amountOut:bigint, gasEstimate:bigint|null}>}
 */
/**
 * Did this quote fail because the CHAIN said no, or because we never reached it?
 *
 * MEASURED, and the reason this function exists: five spaced runs of the ten
 * route search against Base's own two configured endpoints failed 0, 6, 10, 10
 * and 2 routes. Throttling is not an edge case here, it is most runs. Every one
 * of those failures used to be swallowed into `null`, identical to a pool that
 * does not exist.
 *
 * Two different lies came out of that. A total failure told the user "there is
 * no pool with liquidity on Base", a permanent-sounding fact about the chain,
 * when the truth was a busy minute. A PARTIAL failure said nothing at all and
 * quietly dropped whichever routes did not answer, including possibly the best
 * one: on PEPE the winning route pays 2.08x the direct pool, so a user could
 * sign at half the market price with every check on screen passing.
 *
 * A revert is the chain's real answer and is ordinary — most candidate routes
 * genuinely do not exist. Everything else is "we do not know", and this errs
 * towards that: only an explicit contract revert counts as an answer.
 */
function isChainAnswer(err) {
  const code = err && err.code;
  return code === "CALL_EXCEPTION" || code === "BAD_DATA";
}

async function quoteRoute({ provider, quoter, route, amountIn }) {
  try {
    const c = new ethers.Contract(quoter, QUOTER_ABI, provider);
    let res;
    if (route.fees.length === 1) {
      res = await c.quoteExactInputSingle.staticCall({
        tokenIn: route.tokens[0],
        tokenOut: route.tokens[1],
        amountIn,
        fee: route.fees[0],
        sqrtPriceLimitX96: 0n,
      });
    } else {
      res = await c.quoteExactInput.staticCall(encodePath(route.tokens, route.fees), amountIn);
    }
    const amountOut = res[0] ?? res.amountOut;
    if (!amountOut || amountOut === 0n) return null;
    return { route, amountOut, gasEstimate: res[3] ?? null };
  } catch (err) {
    // A revert: this route does not exist or cannot fill the trade. Ordinary.
    if (isChainAnswer(err)) return null;
    // Anything else: we did not get an answer. Reported, never assumed away.
    return { route, unavailable: true };
  }
}

/** Every route worth asking about for this pair on this chain. */
function candidateRoutes({ chain, tokenIn, tokenOut }) {
  const tiers = chain.dex.feeTiers || [100, 500, 3000, 10000];
  const routes = tiers.map((fee) => ({ tokens: [tokenIn, tokenOut], fees: [fee], via: null }));

  // The intermediate is the chain's wrapped native, which is where the deep
  // pools are. Skipped when it is already one end of the trade: a path
  // A -> A -> B is not a route, and the router rejects it.
  const wrapped = chain.wrappedNative && chain.wrappedNative.address;
  const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
  if (wrapped && !same(wrapped, tokenIn) && !same(wrapped, tokenOut)) {
    for (const f1 of HOP_IN_TIERS) {
      for (const f2 of HOP_OUT_TIERS) {
        routes.push({ tokens: [tokenIn, wrapped, tokenOut], fees: [f1, f2], via: chain.wrappedNative.symbol });
      }
    }
  }
  return routes;
}

/**
 * Quote EVERY candidate route, best first, AND say how many could not be asked.
 *
 * It keeps its old name, which is about fee tiers, although it now covers whole
 * routes and reports its own coverage. It is no longer EXPORTED: it was kept
 * exported "so nothing that imported it breaks" and a search of the client found
 * nothing importing it, so the export was a public contract with no public. In a
 * module whose output gets signed that is worse than dead weight — it reads as
 * something a caller depends on, so a future change to it looks consequential
 * when it is not, and a future reader goes looking for a caller that is not
 * there. `bestQuote` below is the entry point.
 *
 * The count is not a diagnostic: with the winning route worth 2.08x the direct
 * pool on PEPE, "we priced eight of ten" is the difference between a best price
 * and a plausible one, and the caller has to be able to tell.
 *
 * @returns {Promise<{quotes:Array, unavailable:number, total:number}>}
 */
async function quoteAllTiers({ provider, chain, tokenIn, tokenOut, amountIn }) {
  if (!chain?.dex?.quoter) return { quotes: [], unavailable: 0, total: 0 };
  const routes = candidateRoutes({ chain, tokenIn, tokenOut });
  const results = await Promise.all(
    routes.map((route) => quoteRoute({ provider, quoter: chain.dex.quoter, route, amountIn }))
  );
  const quotes = results
    .filter((r) => r && !r.unavailable)
    .sort((a, b) => (b.amountOut > a.amountOut ? 1 : b.amountOut < a.amountOut ? -1 : 0));
  return {
    quotes,
    unavailable: results.filter((r) => r && r.unavailable).length,
    total: routes.length,
  };
}

/**
 * Best quote for a trade, with its price impact measured against a dust-sized
 * reference through the SAME route.
 *
 * `fee` is kept on the result as the FIRST hop's tier so existing callers and
 * the `WalletTx.feeTier` column keep working unchanged; `route` carries the
 * whole path for anything that needs it, and `buildSwapTx` reads that.
 *
 * FOUR OUTCOMES, NOT TWO. `null` means the routes were all asked and all said
 * no, which is a real fact about the chain. `{incomplete:true}` means some could
 * not be asked, which is a fact about the moment and must never be dressed up as
 * the first. The caller refuses to trade on an incomplete search rather than
 * quoting the best of what happened to answer, because the route that did not
 * answer may be the one paying twice as much. `{unmeasurable:true}` means the
 * amount is smaller than the reference trade the impact is measured against, so
 * no impact figure exists for it.
 *
 * @returns {Promise<null|{incomplete:true, unavailable:number, total:number, priced:number}|{unmeasurable:true, amountIn:bigint, dustDivisor:bigint}|{fee:number, fees:number[], route:object, amountOut:bigint, impactPct:number, alternatives:number, via:string|null}>}
 */
export async function bestQuote({ provider, chain, tokenIn, tokenOut, amountIn }) {
  const { quotes, unavailable, total } = await quoteAllTiers({
    provider, chain, tokenIn, tokenOut, amountIn,
  });

  // Every route answered, and every answer was no. A genuine "no pool".
  if (!quotes.length && !unavailable) return null;

  // Some route could not be asked. Refusing costs a retry; guessing costs the
  // difference between the best route and the best route that answered.
  if (unavailable > 0) {
    return { incomplete: true, unavailable, total, priced: quotes.length };
  }

  const best = quotes[0];

  // Reference rate from a trade small enough not to move the pools, through the
  // same route — a reference taken on a different route would measure the
  // difference between two routes rather than the impact of this size.
  /**
   * AN AMOUNT TOO SMALL TO HAVE A REFERENCE BENEATH IT.
   *
   * `dust` is integer division, so anything under DUST_DIVISOR base units gives
   * zero and the whole measurement below was skipped — leaving `impactPct` at
   * its initialiser of 0, which the confirm screen then rendered as "0.00%" and
   * the guardrails compared against the user's impact cap as though it were a
   * reading. That is precisely what the comment inside the block says must
   * never happen, avoided everywhere except above its own guard. It became
   * reachable when trading opened to long-tail tokens, where low-decimal
   * contracts and thin pools live together.
   *
   * Said as its own outcome rather than folded into the incomplete-search one:
   * a search that could be retried and an amount that is simply too small to
   * price are different answers and want different advice.
   */
  const dust = amountIn / DUST_DIVISOR;
  if (dust === 0n) {
    return { unmeasurable: true, amountIn, dustDivisor: DUST_DIVISOR };
  }
  let impactPct = 0;
  if (dust > 0n) {
    const ref = await quoteRoute({ provider, quoter: chain.dex.quoter, route: best.route, amountIn: dust });
    /**
     * A reference that could not be TAKEN is not a reference of zero.
     *
     * Leaving `impactPct` at 0 here would render as "this trade moves the pool
     * not at all" — the most reassuring number on the confirm screen, produced
     * by a measurement that never happened, and then compared against the
     * user's impact cap as though it were real. Treated as an incomplete
     * search, which is what it is.
     */
    if (ref && ref.unavailable) {
      return { incomplete: true, unavailable: 1, total: total + 1, priced: quotes.length };
    }
    if (ref) {
      // Rates as floats only for the ratio — both sides are scaled identically,
      // so the division is safe and the result is a percentage.
      const refRate = Number(ref.amountOut) / Number(dust);
      const realRate = Number(best.amountOut) / Number(amountIn);
      if (refRate > 0) impactPct = Math.max(0, ((refRate - realRate) / refRate) * 100);
    }
  }

  return {
    fee: best.route.fees[0],
    fees: best.route.fees,
    route: best.route,
    via: best.route.via,
    amountOut: best.amountOut,
    impactPct,
    alternatives: quotes.length,
  };
}

/**
 * Encoded swap, ready to estimate, simulate or sign.
 *
 * WRAPPED IN `multicall(deadline, [data])`, AND THAT IS THE POINT.
 *
 * This used to encode a bare `exactInputSingle`, whose parameter struct has no
 * deadline field. A signed transaction with no expiry is a STANDING ORDER: it
 * rests in the mempool indefinitely and executes whenever it is eventually
 * mined, at any price still above `amountOutMinimum`.
 *
 * Measured on Ethereum: 1000 USDC buying WBTC at 1% slippage sets a floor that
 * the transaction will accept forever, so an underpriced or stalled transaction
 * mined the next morning after a fall buys at yesterday's floor. On a 1000 USDC
 * trade with BTC down to 60,000 that is about 236 USD lost, with no revert, no
 * warning, and a history row reading "confirmed". Nothing bounds the delay, and
 * the app offers no way to cancel.
 *
 * CLAUDE.md section 9 recorded this as unavoidable: "a deadline would require
 * multicall(uint256, bytes[]), which this code does not use". The first half is
 * right and the conclusion was wrong. The selector 0x5ae401dc is present in the
 * deployed router bytecode on every chain in the registry, including the two
 * added most recently, so the mitigation was available the whole time. It is one
 * extra encode.
 *
 * THE ROUTE DECIDES WHICH CALL IS ENCODED. A single-hop route uses
 * `exactInputSingle`; a multi-hop route uses `exactInput` with the same encoded
 * path the quote was taken on. Passing the quote's own route rather than a pair
 * of addresses is what keeps the two in step: encoding a direct swap for a quote
 * that was measured through the wrapped native would sign a trade at a price
 * nobody quoted, which on PEPE is a factor of two.
 */
export function buildSwapTx({ chain, quote, amountIn, amountOutMinimum, recipient, tokenIn, tokenOut }) {
  const route = quote && quote.route;
  if (!route || !Array.isArray(route.tokens) || !Array.isArray(route.fees)) {
    throw new Error("A swap cannot be built without the route its price came from.");
  }

  /**
   * THE ROUTE MUST START AND END WHERE THE USER THINKS IT DOES.
   *
   * In today's flow the same route object drives the quote and this encode, so
   * they cannot disagree. That is a property of one call site, not of this
   * function, and this is the function whose output is signed. Checking the two
   * ends costs nothing and means a later refactor that threads a stale or
   * mismatched quote through here fails loudly instead of encoding a swap that
   * spends the wrong token or delivers to the wrong one.
   *
   * The arguments are optional so existing callers keep working; when they are
   * given, they are enforced.
   */
  const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
  const first = route.tokens[0];
  const last = route.tokens[route.tokens.length - 1];
  if (tokenIn && !same(first, tokenIn)) {
    throw new Error("This price was quoted for a different token than the one being spent.");
  }
  if (tokenOut && !same(last, tokenOut)) {
    throw new Error("This price was quoted for a different token than the one being bought.");
  }

  const iface = new ethers.Interface(ROUTER_ABI);
  const inner =
    route.fees.length === 1
      ? iface.encodeFunctionData("exactInputSingle", [
          {
            tokenIn: route.tokens[0],
            tokenOut: route.tokens[1],
            fee: route.fees[0],
            recipient,
            amountIn,
            amountOutMinimum,
            sqrtPriceLimitX96: 0n,
          },
        ])
      : iface.encodeFunctionData("exactInput", [
          {
            path: encodePath(route.tokens, route.fees),
            recipient,
            amountIn,
            amountOutMinimum,
          },
        ]);

  const deadline = BigInt(Math.floor(Date.now() / 1000) + DEADLINE_SECONDS);
  return {
    to: chain.dex.router,
    data: iface.encodeFunctionData("multicall", [deadline, [inner]]),
    // Surfaced so the confirm screen can say when the quote stops being valid.
    deadline,
  };
}

/** Minimum received after slippage, as the router's `amountOutMinimum`. */
export function minOut(amountOut, slippagePct) {
  const bps = BigInt(Math.round(Math.max(0, Math.min(50, slippagePct)) * 100));
  return (amountOut * (10000n - bps)) / 10000n;
}

/*
 * `allowanceFor({ provider, chain, token, owner })` used to live here and had no
 * caller anywhere in the client: `planSwap` reads the allowance inline from the
 * contract it has already built. Two implementations of one fact is the shape
 * LW-034 exists for, and the one nothing calls is the one that rots, so it is
 * removed rather than left looking load-bearing. The reader wanting the router
 * allowance wants `liveSwap.planSwap`, which returns it on the plan.
 */

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
