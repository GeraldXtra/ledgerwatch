import { describe, it, expect, vi, beforeEach } from "vitest";
import { ethers } from "ethers";

vi.mock("../../provider", async (importOriginal) => ({
  ...(await importOriginal()),
  getProvider: vi.fn(),
}));

import { getProvider } from "../../provider";
import { ADDRESS_THIS, buildSwapTx, buildUnwrapTx, buildWrapTx } from "../../../market/dex";
import { CHAIN, FROM, TRAP, UNVERIFIED, USDC, WETH, fakeDex } from "../../../market/__tests__/fakeDex";
import { swapAssets, isWrappedNative, assetBalance } from "../assets";
import { planEvmSwap, swapKind, toUnits } from "../evmSwap";

const ROUTER_IFACE = new ethers.Interface([
  "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)",
  "function exactInput((bytes path,address recipient,uint256 amountIn,uint256 amountOutMinimum)) payable returns (uint256 amountOut)",
  "function multicall(uint256 deadline, bytes[] data) payable returns (bytes[] results)",
  "function unwrapWETH9(uint256 amountMinimum, address recipient) payable",
]);
const WETH_IFACE = new ethers.Interface(["function deposit() payable", "function withdraw(uint256 wad)"]);

const CUSTOM = { symbol: "TRAP", address: TRAP, decimals: 18, custom: true, chainId: CHAIN.chainId };
const ASSETS = swapAssets(CHAIN, [...CHAIN.tokens, CUSTOM]);
const byKey = (key) => ASSETS.find((a) => a.key === key);
const NATIVE = byKey(`evm:${CHAIN.chainId}:native`);
const CASH = byKey(`evm:${CHAIN.chainId}:${USDC.toLowerCase()}`);
const WRAPPED = byKey(`evm:${CHAIN.chainId}:${WETH.toLowerCase()}`);
const TRAPPED = byKey(`evm:${CHAIN.chainId}:${TRAP.toLowerCase()}`);

function innerCalls(data) {
  const outer = ROUTER_IFACE.decodeFunctionData("multicall", data);
  return { deadline: outer[0], calls: outer[1].map((d) => ROUTER_IFACE.parseTransaction({ data: d })) };
}

const prices = { ETH: 2500, WETH: 2500 };
const usdPriceFor = (s) => prices[String(s).toUpperCase()] ?? null;

function plan(dex, from, to, amountDisplay, extra = {}) {
  vi.mocked(getProvider).mockReturnValue(dex.provider);
  return planEvmSwap({
    chain: CHAIN,
    address: FROM,
    from,
    to,
    amountIn: toUnits(amountDisplay, from.decimals),
    amountInDisplay: Number(amountDisplay),
    slippagePct: 1,
    spentToday: 0,
    usdPriceFor,
    ...extra,
  });
}

describe("LW-158 — the asset list for a network", () => {
  it("lists the native coin, every verified token and the user's added tokens, with verification kept apart", () => {
    expect(ASSETS.map((a) => a.symbol)).toEqual(["ETH", "USDC", "WETH", "TRAP"]);
    expect(NATIVE).toMatchObject({ native: true, verified: true, address: null, decimals: 18 });
    expect(WRAPPED).toMatchObject({ native: false, verified: true });
    expect(TRAPPED).toMatchObject({ native: false, verified: false, custom: true });
    expect(isWrappedNative(CHAIN, WRAPPED)).toBe(true);
    expect(isWrappedNative(CHAIN, CASH)).toBe(false);
  });

  it("tells a swap, a wrap and an unwrap apart, and refuses the same asset twice", () => {
    expect(swapKind(CHAIN, CASH, TRAPPED)).toBe("swap");
    expect(swapKind(CHAIN, NATIVE, WRAPPED)).toBe("wrap");
    expect(swapKind(CHAIN, WRAPPED, NATIVE)).toBe("unwrap");
    expect(swapKind(CHAIN, NATIVE, CASH)).toBe("swap");
    expect(swapKind(CHAIN, CASH, CASH)).toBe("same");
  });

  it("reads a balance by the native flag or the address, never guessing at an unread one", () => {
    const balances = [
      { symbol: "ETH", native: true, amount: "0.5" },
      { symbol: "USDC", address: USDC.toLowerCase(), amount: "12.5" },
      { symbol: "WETH", address: WETH, unknown: true },
    ];
    expect(assetBalance(NATIVE, balances)).toBe(0.5);
    expect(assetBalance(CASH, balances)).toBe(12.5);
    expect(assetBalance(WRAPPED, balances)).toBeNull();
  });
});

describe("LW-158 — the transaction for each kind of swap", () => {
  const quote = { route: { tokens: [WETH, USDC], fees: [500], via: null } };

  it("pays the native coin as transaction value and routes it from the wrapped token, with no approval", () => {
    const tx = buildSwapTx({ chain: CHAIN, quote, amountIn: 10n ** 17n, amountOutMinimum: 240_000_000n, recipient: FROM, tokenIn: WETH, tokenOut: USDC, nativeIn: true });
    expect(tx.value).toBe(10n ** 17n);
    const { calls } = innerCalls(tx.data);
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe("exactInputSingle");
    expect(calls[0].args[0].tokenIn).toBe(WETH);
    expect(calls[0].args[0].recipient).toBe(FROM);
  });

  it("pays the native coin out by swapping to the router itself and unwrapping to the user in the same call, at the same minimum", () => {
    const back = { route: { tokens: [USDC, WETH], fees: [500], via: null } };
    const tx = buildSwapTx({ chain: CHAIN, quote: back, amountIn: 250_000_000n, amountOutMinimum: 99_000_000_000_000_000n, recipient: FROM, tokenIn: USDC, tokenOut: WETH, nativeOut: true });
    expect(tx.value).toBe(0n);
    const { calls, deadline } = innerCalls(tx.data);
    expect(calls.map((c) => c.name)).toEqual(["exactInputSingle", "unwrapWETH9"]);
    expect(calls[0].args[0].recipient).toBe(ADDRESS_THIS);
    expect(calls[1].args[0]).toBe(99_000_000_000_000_000n);
    expect(calls[1].args[1]).toBe(FROM);
    expect(Number(deadline)).toBeGreaterThan(Math.floor(Date.now() / 1000) + 600);
  });

  it("refuses a native leg whose route does not start or end at the wrapped token", () => {
    const wrong = { route: { tokens: [USDC, TRAP], fees: [500], via: null } };
    expect(() => buildSwapTx({ chain: CHAIN, quote: wrong, amountIn: 1n, amountOutMinimum: 1n, recipient: FROM, nativeIn: true })).toThrow(/wrapped token/);
    expect(() => buildSwapTx({ chain: CHAIN, quote: wrong, amountIn: 1n, amountOutMinimum: 1n, recipient: FROM, nativeOut: true })).toThrow(/wrapped token/);
  });

  it("encodes a two-hop path through the wrapped coin with the recipient and minimum intact", () => {
    const hop = { route: { tokens: [USDC, WETH, TRAP], fees: [500, 3000], via: "WETH" } };
    const tx = buildSwapTx({ chain: CHAIN, quote: hop, amountIn: 25_000_000n, amountOutMinimum: 7n, recipient: FROM, tokenIn: USDC, tokenOut: TRAP });
    const { calls } = innerCalls(tx.data);
    expect(calls[0].name).toBe("exactInput");
    const path = calls[0].args[0].path;
    expect(ethers.dataLength(path)).toBe(20 + 3 + 20 + 3 + 20);
    expect(ethers.getAddress(ethers.dataSlice(path, 0, 20))).toBe(USDC);
    expect(ethers.getAddress(ethers.dataSlice(path, 23, 43))).toBe(WETH);
    expect(ethers.getAddress(ethers.dataSlice(path, 46, 66))).toBe(TRAP);
    expect(calls[0].args[0].amountOutMinimum).toBe(7n);
    expect(calls[0].args[0].recipient).toBe(FROM);
  });

  it("wraps and unwraps through the wrapped coin's own contract, one for one", () => {
    const wrap = buildWrapTx({ chain: CHAIN, amount: 3n });
    expect(wrap.to).toBe(WETH);
    expect(wrap.value).toBe(3n);
    expect(WETH_IFACE.parseTransaction({ data: wrap.data }).name).toBe("deposit");
    const unwrap = buildUnwrapTx({ chain: CHAIN, amount: 4n });
    expect(unwrap.value).toBe(0n);
    const parsed = WETH_IFACE.parseTransaction({ data: unwrap.data });
    expect(parsed.name).toBe("withdraw");
    expect(parsed.args[0]).toBe(4n);
    expect(() => buildWrapTx({ chain: { ...CHAIN, wrappedNative: null }, amount: 1n })).toThrow(/wrapped coin/);
  });
});

describe("LW-158 — planning any pair on a network", () => {
  beforeEach(() => vi.mocked(getProvider).mockReset());

  it("plans a native coin into a stablecoin: no approval, value on the swap, the simulation funded by that value", async () => {
    const dex = fakeDex();
    const p = await plan(dex, NATIVE, CASH, "0.1");
    expect(p.ok).toBe(true);
    expect(p.kind).toBe("swap");
    expect(p.needsApproval).toBe(false);
    expect(p.swapTx.value).toBe(10n ** 17n);
    expect(p.cashValueDisplay).toBeCloseTo(Number(ethers.formatUnits(p.quote.amountOut, 6)), 6);
    const sim = dex.simulations.at(-1);
    const swapCall = sim.find((c) => String(c.to).toLowerCase() === CHAIN.dex.router.toLowerCase());
    expect(swapCall.value).toBe(ethers.toQuantity(10n ** 17n));
    expect(p.safety).toMatchObject({ checked: true, ok: true });
  });

  it("plans a stablecoin into the native coin, valued from the stablecoin side, and checks the swap itself", async () => {
    const dex = fakeDex();
    const p = await plan(dex, CASH, NATIVE, "25");
    expect(p.ok).toBe(true);
    expect(p.swapTx.nativeOut).toBe(true);
    expect(p.cashValueDisplay).toBe(25);
    expect(dex.events).toContain("plain-swap-check");
    expect(p.needsSafetyAck).toBe(false);
  });

  it("values a token-to-token swap with a known price, and refuses one it cannot value", async () => {
    const dex = fakeDex();
    const priced = await plan(dex, WRAPPED, TRAPPED, "0.01");
    expect(priced.cashValueDisplay).toBeCloseTo(25, 6);
    expect(priced.cashBasis).toBe("WETH");

    const unpriced = await plan(fakeDex(), WRAPPED, TRAPPED, "0.01", { usdPriceFor: () => null });
    expect(unpriced.ok).toBe(false);
    expect(unpriced.cashValueDisplay).toBeNull();
    expect(unpriced.blocks.join(" ")).toMatch(/cannot be checked against your trading limits/);
  });

  it("still refuses a token that cannot be sold back, whatever it is paid with", async () => {
    const p = await plan(fakeDex({ sellable: false }), NATIVE, TRAPPED, "0.01");
    expect(p.ok).toBe(false);
    expect(p.safety).toMatchObject({ kind: "cannot-sell" });
  });

  it("plans a wrap and an unwrap without an exchange, one for one, with the fee and caps checked", async () => {
    const wrap = await plan(fakeDex(), NATIVE, WRAPPED, "0.2");
    expect(wrap).toMatchObject({ ok: true, kind: "wrap", needsApproval: false, amountOutDisplay: 0.2, cashValueDisplay: 500 });
    expect(wrap.swapTx.to).toBe(WETH);
    expect(wrap.swapTx.value).toBe(toUnits("0.2", 18));
    expect(wrap.routeLabel).toBe("ETH > WETH (wrap)");

    const unwrap = await plan(fakeDex(), WRAPPED, NATIVE, "0.2");
    expect(unwrap).toMatchObject({ kind: "unwrap", needsApproval: false });
    expect(unwrap.ok).toBe(false);
    expect(unwrap.blocks.join(" ")).toMatch(/You hold 0\.000000 WETH/);
  });

  it("refuses the same asset on both sides and a pair with no pool", async () => {
    const same = await plan(fakeDex(), CASH, CASS(), "1");
    expect(same.ok).toBe(false);
    expect(same.reason).toBe("same-asset");
  });

  function CASS() {
    return CASH;
  }

  it("applies the per-trade cap to a native swap valued in dollars", async () => {
    const p = await plan(fakeDex(), NATIVE, CASH, "0.5", { limitOverrides: { perTrade: 0.1 } });
    expect(p.cashValueDisplay).toBeCloseTo(0.125, 6);
    expect(p.ok).toBe(false);
    expect(p.blocks.join(" ")).toMatch(/per trade cap/);
  });

  it("asks for an acknowledgement when the output token is unverified and the network cannot simulate", async () => {
    const p = await plan(fakeDex({ simulate: false }), NATIVE, { ...UNVERIFIED, key: "x", native: false, verified: false }, "0.01");
    expect(p.needsSafetyAck).toBe(true);
    expect(p.warnings.join(" ")).toMatch(/could not be checked/);
  });
});
