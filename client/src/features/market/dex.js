import { ethers } from "ethers";

const QUOTER_ABI = [
  "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)",
  "function quoteExactInput(bytes path, uint256 amountIn) returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)",
];

const ROUTER_ABI = [
  "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)",
  "function exactInput((bytes path,address recipient,uint256 amountIn,uint256 amountOutMinimum)) payable returns (uint256 amountOut)",
  "function multicall(uint256 deadline, bytes[] data) payable returns (bytes[] results)",
  "function unwrapWETH9(uint256 amountMinimum, address recipient) payable",
];

const WETH9_ABI = ["function deposit() payable", "function withdraw(uint256 wad)"];

export const ADDRESS_THIS = "0x0000000000000000000000000000000000000002";

const DEADLINE_SECONDS = Number(import.meta.env?.VITE_SWAP_DEADLINE_SECONDS) || 1200;

export const ERC20_ALLOWANCE_ABI = [
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
];

const DUST_DIVISOR = 1000n;

const HOP_IN_TIERS = [500, 3000];
const HOP_OUT_TIERS = [500, 3000, 10000];

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
    if (isChainAnswer(err)) return null;
    return { route, unavailable: true };
  }
}

function candidateRoutes({ chain, tokenIn, tokenOut }) {
  const tiers = chain.dex.feeTiers || [100, 500, 3000, 10000];
  const routes = tiers.map((fee) => ({ tokens: [tokenIn, tokenOut], fees: [fee], via: null }));

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

export async function bestQuote({ provider, chain, tokenIn, tokenOut, amountIn }) {
  const { quotes, unavailable, total } = await quoteAllTiers({
    provider, chain, tokenIn, tokenOut, amountIn,
  });

  if (!quotes.length && !unavailable) return null;

  if (unavailable > 0) {
    return { incomplete: true, unavailable, total, priced: quotes.length };
  }

  const best = quotes[0];

  const dust = amountIn / DUST_DIVISOR;
  if (dust === 0n) {
    return { unmeasurable: true, amountIn, dustDivisor: DUST_DIVISOR };
  }
  let impactPct = 0;
  if (dust > 0n) {
    const ref = await quoteRoute({ provider, quoter: chain.dex.quoter, route: best.route, amountIn: dust });
    if (ref && ref.unavailable) {
      return { incomplete: true, unavailable: 1, total: total + 1, priced: quotes.length };
    }
    if (ref) {
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

export function buildSwapTx({
  chain,
  quote,
  amountIn,
  amountOutMinimum,
  recipient,
  tokenIn,
  tokenOut,
  nativeIn = false,
  nativeOut = false,
}) {
  const route = quote && quote.route;
  if (!route || !Array.isArray(route.tokens) || !Array.isArray(route.fees)) {
    throw new Error("A swap cannot be built without the route its price came from.");
  }

  const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
  const first = route.tokens[0];
  const last = route.tokens[route.tokens.length - 1];
  if (tokenIn && !same(first, tokenIn)) {
    throw new Error("This price was quoted for a different token than the one being spent.");
  }
  if (tokenOut && !same(last, tokenOut)) {
    throw new Error("This price was quoted for a different token than the one being bought.");
  }
  const wrapped = chain.wrappedNative && chain.wrappedNative.address;
  if (nativeIn && !(wrapped && same(first, wrapped))) {
    throw new Error("A swap paid in the native coin must start from its wrapped token.");
  }
  if (nativeOut && !(wrapped && same(last, wrapped))) {
    throw new Error("A swap paid out in the native coin must end at its wrapped token.");
  }

  const iface = new ethers.Interface(ROUTER_ABI);
  const swapRecipient = nativeOut ? ADDRESS_THIS : recipient;
  const inner =
    route.fees.length === 1
      ? iface.encodeFunctionData("exactInputSingle", [
          {
            tokenIn: route.tokens[0],
            tokenOut: route.tokens[1],
            fee: route.fees[0],
            recipient: swapRecipient,
            amountIn,
            amountOutMinimum,
            sqrtPriceLimitX96: 0n,
          },
        ])
      : iface.encodeFunctionData("exactInput", [
          {
            path: encodePath(route.tokens, route.fees),
            recipient: swapRecipient,
            amountIn,
            amountOutMinimum,
          },
        ]);
  const calls = [inner];
  if (nativeOut) calls.push(iface.encodeFunctionData("unwrapWETH9", [amountOutMinimum, recipient]));

  const deadline = BigInt(Math.floor(Date.now() / 1000) + DEADLINE_SECONDS);
  return {
    to: chain.dex.router,
    data: iface.encodeFunctionData("multicall", [deadline, calls]),
    deadline,
    value: nativeIn ? amountIn : 0n,
    nativeIn,
    nativeOut,
  };
}

function wrappedCoinOf(chain) {
  const weth = chain && chain.wrappedNative;
  if (!weth || !weth.address) {
    throw new Error(`${(chain && chain.name) || "This network"} has no verified wrapped coin.`);
  }
  return weth;
}

export function buildWrapTx({ chain, amount }) {
  const weth = wrappedCoinOf(chain);
  const iface = new ethers.Interface(WETH9_ABI);
  return { to: weth.address, data: iface.encodeFunctionData("deposit", []), value: amount, deadline: null };
}

export function buildUnwrapTx({ chain, amount }) {
  const weth = wrappedCoinOf(chain);
  const iface = new ethers.Interface(WETH9_ABI);
  return { to: weth.address, data: iface.encodeFunctionData("withdraw", [amount]), value: 0n, deadline: null };
}

export function minOut(amountOut, slippagePct) {
  const bps = BigInt(Math.round(Math.max(0, Math.min(50, slippagePct)) * 100));
  return (amountOut * (10000n - bps)) / 10000n;
}

export async function simulateSwap({ provider, tx, from }) {
  try {
    await provider.call({ ...tx, from });
    return { ok: true };
  } catch (err) {
    const msg = err?.shortMessage || err?.reason || err?.message || "The swap would fail.";
    return { ok: false, error: msg };
  }
}
