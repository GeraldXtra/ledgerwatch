import { describe, it, expect, vi, beforeEach } from "vitest";
import { ethers } from "ethers";

vi.mock("../../wallet/provider", async (importOriginal) => ({
  ...(await importOriginal()),
  getProvider: vi.fn(),
}));

import { getProvider } from "../../wallet/provider";
import { encodePath, buildSwapTx } from "../dex";
import { describeTradeSafety, isVerifiedToken, simulateTrade } from "../tradeSimulation";
import { planSwap } from "../liveSwap";
import { CASH, CHAIN, FROM, TRAP, UNVERIFIED, USDC, VERIFIED, WETH, fakeDex } from "./fakeDex";

const ROUTER_IFACE = new ethers.Interface([
  "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)",
  "function exactInput((bytes path,address recipient,uint256 amountIn,uint256 amountOutMinimum)) payable returns (uint256 amountOut)",
  "function multicall(uint256 deadline, bytes[] data) payable returns (bytes[] results)",
]);
const ERC20_IFACE = new ethers.Interface(["function approve(address,uint256)", "function balanceOf(address)"]);

const word = (n) => ethers.toBeHex(n, 32);
const ok = (value) => ({ status: "0x1", returnData: value == null ? "0x" : word(value), gasUsed: "0x1", logs: [] });
const reverted = (message) => ({ status: "0x0", returnData: "0x", gasUsed: "0x1", error: { code: 3, message: `execution reverted: ${message}` } });

function innerOf(call) {
  const outer = ROUTER_IFACE.decodeFunctionData("multicall", call.data);
  return ROUTER_IFACE.parseTransaction({ data: outer[1][0] });
}

function directQuote(fee = 500) {
  return { route: { tokens: [USDC, TRAP], fees: [fee], via: null } };
}

function input({ quote = directQuote(), needsApproval = false, sellBack = true } = {}) {
  const amountIn = 25_000_000n;
  const amountOutMinimum = 99_000_000_000_000_000_000n;
  const swapTx = buildSwapTx({ chain: CHAIN, quote, amountIn, amountOutMinimum, recipient: FROM, tokenIn: USDC, tokenOut: quote.route.tokens.at(-1) });
  return {
    chain: CHAIN,
    from: FROM,
    tokenIn: CASH,
    tokenOut: quote.route.tokens.at(-1) === TRAP ? UNVERIFIED : { symbol: "PEPE", address: quote.route.tokens.at(-1), decimals: 18 },
    amountIn,
    amountOutMinimum,
    swapTx,
    quote,
    needsApproval,
    sellBack,
  };
}

function providerAnswering(build) {
  const send = vi.fn(async (method, params) => {
    const calls = params[0].blockStateCalls[0].calls;
    return [{ calls: build(calls) }];
  });
  return { send };
}

describe("LW-092 — the buy is simulated together with selling it straight back", () => {
  it("asks for one simulation with the buy, the measured balance and the sale back on the reversed route", async () => {
    const provider = providerAnswering((calls) => calls.map(() => ok(0n)));
    await simulateTrade({ provider, ...input() });
    expect(provider.send).toHaveBeenCalledTimes(1);
    const [method, [payload, tag]] = provider.send.mock.calls[0];
    expect(method).toBe("eth_simulateV1");
    expect(tag).toBe("latest");
    expect(payload.validation).toBe(false);
    const calls = payload.blockStateCalls[0].calls;
    expect(calls).toHaveLength(7);
    expect(calls.every((c) => c.from === FROM)).toBe(true);

    const sellApprove = ERC20_IFACE.decodeFunctionData("approve", calls[3].data);
    expect(calls[3].to).toBe(TRAP);
    expect(sellApprove[1]).toBe(input().amountOutMinimum);

    const sell = innerOf(calls[5]);
    expect(sell.name).toBe("exactInputSingle");
    expect(sell.args[0].tokenIn).toBe(TRAP);
    expect(sell.args[0].tokenOut).toBe(USDC);
    expect(sell.args[0].recipient).toBe(FROM);
    expect(sell.args[0].amountIn).toBe(input().amountOutMinimum);
    expect(sell.args[0].amountOutMinimum).toBe(0n);
  });

  it("reverses a route through the wrapped native coin, fees included", async () => {
    const quote = { route: { tokens: [USDC, WETH, "0x6982508145454Ce325dDbE47a25d4ec3d2311933"], fees: [500, 3000], via: "WETH" } };
    const provider = providerAnswering((calls) => calls.map(() => ok(0n)));
    await simulateTrade({ provider, ...input({ quote }) });
    const calls = provider.send.mock.calls[0][1][0].blockStateCalls[0].calls;
    const sell = innerOf(calls[5]);
    expect(sell.name).toBe("exactInput");
    expect(sell.args[0].path).toBe(encodePath(["0x6982508145454Ce325dDbE47a25d4ec3d2311933", WETH, USDC], [3000, 500]));
  });

  it("includes the approval the buy needs, so a trap is found before the approval is paid for", async () => {
    const provider = providerAnswering((calls) => calls.map(() => ok(0n)));
    await simulateTrade({ provider, ...input({ needsApproval: true }) });
    const calls = provider.send.mock.calls[0][1][0].blockStateCalls[0].calls;
    expect(calls).toHaveLength(8);
    expect(calls[0].to).toBe(USDC);
    const approve = ERC20_IFACE.decodeFunctionData("approve", calls[0].data);
    expect(approve[1]).toBe(input().amountIn);
  });

  it("refuses a token whose sale back fails", async () => {
    const provider = providerAnswering(() => [ok(0n), ok(), ok(10n ** 20n), ok(), ok(0n), reverted("TRANSFER_FROM_FAILED"), ok(0n)]);
    const safety = await simulateTrade({ provider, ...input() });
    expect(safety).toMatchObject({ checked: true, ok: false, kind: "cannot-sell", detail: "TRANSFER_FROM_FAILED" });
    const verdict = describeTradeSafety({ safety, side: "buy", chain: CHAIN, tokenIn: CASH, tokenOut: UNVERIFIED, amountOutMinimum: input().amountOutMinimum });
    expect(verdict.blocks).toHaveLength(1);
    expect(verdict.blocks[0]).toMatch(/could be bought but selling it straight back to USDC failed \(TRANSFER_FROM_FAILED\)/);
  });

  it("refuses a token whose approval to sell fails", async () => {
    const provider = providerAnswering(() => [ok(0n), ok(), ok(10n ** 20n), reverted("blocked"), ok(0n), ok(), ok(0n)]);
    const safety = await simulateTrade({ provider, ...input() });
    expect(safety).toMatchObject({ ok: false, kind: "cannot-sell", detail: "blocked" });
  });

  it("refuses a token whose sale back returns nothing", async () => {
    const provider = providerAnswering(() => [ok(0n), ok(), ok(10n ** 20n), ok(), ok(5n), ok(), ok(5n)]);
    const safety = await simulateTrade({ provider, ...input() });
    expect(safety).toMatchObject({ ok: false, kind: "cannot-sell", detail: "it returned nothing" });
  });

  it("passes a token that sells back, and reports what the sale returned", async () => {
    const provider = providerAnswering(() => [ok(0n), ok(), ok(10n ** 20n), ok(), ok(1_000n), ok(), ok(24_001_000n)]);
    const safety = await simulateTrade({ provider, ...input() });
    expect(safety).toEqual({ checked: true, ok: true, received: 10n ** 20n, soldBack: 24_000_000n, sellAmount: input().amountOutMinimum });
    expect(describeTradeSafety({ safety, side: "buy", chain: CHAIN, tokenIn: CASH, tokenOut: UNVERIFIED, amountOutMinimum: input().amountOutMinimum })).toEqual({ blocks: [], warnings: [], needsAck: false });
  });

  it("does not sell back on a sale", async () => {
    const provider = providerAnswering((calls) => calls.map(() => ok(10n ** 20n)));
    await simulateTrade({ provider, ...input({ sellBack: false }) });
    expect(provider.send.mock.calls[0][1][0].blockStateCalls[0].calls).toHaveLength(3);
  });

  it("never reports an unavailable check as a pass", async () => {
    const refused = { send: vi.fn().mockRejectedValue(new Error("the method eth_simulateV1 does not exist")) };
    expect(await simulateTrade({ provider: refused, ...input() })).toMatchObject({ checked: false });
    const short = providerAnswering(() => [ok(0n)]);
    expect(await simulateTrade({ provider: short, ...input() })).toMatchObject({ checked: false, reason: /incomplete/ });
    const unreadable = providerAnswering(() => [{ status: "0x1", returnData: "0x", gasUsed: "0x1", logs: [] }, ok(), ok(0n), ok(), ok(0n), ok(), ok(0n)]);
    expect(await simulateTrade({ provider: unreadable, ...input() })).toMatchObject({ checked: false });
  });

  it("asks for an acknowledgement only for a buy of a token nobody checked by hand", () => {
    const safety = { checked: false, reason: "the method eth_simulateV1 does not exist" };
    const base = { safety, chain: CHAIN, tokenIn: CASH, amountOutMinimum: 1n };
    const unverifiedBuy = describeTradeSafety({ ...base, side: "buy", tokenOut: UNVERIFIED });
    expect(unverifiedBuy.needsAck).toBe(true);
    expect(unverifiedBuy.blocks).toEqual([]);
    expect(unverifiedBuy.warnings[0]).toMatch(/Whether TRAP can be sold again could not be checked on Base Sepolia/);
    expect(describeTradeSafety({ ...base, side: "buy", tokenOut: VERIFIED }).needsAck).toBe(false);
    expect(describeTradeSafety({ ...base, side: "sell", tokenIn: UNVERIFIED, tokenOut: CASH }).needsAck).toBe(false);
    expect(isVerifiedToken(CHAIN, VERIFIED)).toBe(true);
    expect(isVerifiedToken(CHAIN, UNVERIFIED)).toBe(false);
  });

  it("says what was checked instead, depending on whether the approval is still outstanding", () => {
    const safety = { checked: false, reason: "down" };
    const before = describeTradeSafety({ safety, side: "buy", chain: CHAIN, tokenIn: CASH, tokenOut: UNVERIFIED, amountOutMinimum: 1n, needsApproval: true });
    expect(before.warnings[0]).toMatch(/checked once the approval has confirmed/);
    const after = describeTradeSafety({ safety, side: "buy", chain: CHAIN, tokenIn: CASH, tokenOut: UNVERIFIED, amountOutMinimum: 1n, needsApproval: false });
    expect(after.warnings[0]).toMatch(/only a check that the swap itself does not fail was made/);
  });
});

describe("LW-092 — planSwap refuses a token that cannot be sold, before anything is signed", () => {
  beforeEach(() => vi.mocked(getProvider).mockReset());

  const plan = (dex, tokenOut = UNVERIFIED) => {
    vi.mocked(getProvider).mockReturnValue(dex.provider);
    return planSwap({
      chain: CHAIN,
      address: FROM,
      side: "buy",
      tokenIn: CASH,
      tokenOut,
      amountIn: 25_000_000n,
      amountInDisplay: 25,
      slippagePct: 1,
      spentToday: 0,
    });
  };

  it("offers an honest token and shows what selling it back would return", async () => {
    const dex = fakeDex();
    const p = await plan(dex);
    expect(p.blocks).toEqual([]);
    expect(p.ok).toBe(true);
    expect(p.needsSafetyAck).toBe(false);
    expect(p.safety).toMatchObject({ checked: true, ok: true });
    expect(p.safety.soldBack > 0n).toBe(true);
    expect(dex.simulations).toHaveLength(1);
  });

  it("refuses a token that can be bought but not sold", async () => {
    const p = await plan(fakeDex({ sellable: false }));
    expect(p.ok).toBe(false);
    expect(p.blocks.join(" ")).toMatch(/could be bought but selling it straight back to USDC failed/);
  });

  it("refuses it even before the approval, so the approval is never paid for", async () => {
    const p = await plan(fakeDex({ sellable: false, allowance: 0n }));
    expect(p.needsApproval).toBe(true);
    expect(p.ok).toBe(false);
    expect(p.blocks.join(" ")).toMatch(/selling it straight back/);
  });

  it("asks for an acknowledgement when the network cannot simulate, and still runs the plain check", async () => {
    const dex = fakeDex({ simulate: false });
    const p = await plan(dex);
    expect(p.safety).toMatchObject({ checked: false });
    expect(p.needsSafetyAck).toBe(true);
    expect(p.warnings.join(" ")).toMatch(/could not be checked/);
    expect(dex.events).toContain("plain-swap-check");
    expect(p.ok).toBe(true);
  });

  it("does not ask for it for a token on the hand-checked list", async () => {
    const p = await plan(fakeDex({ simulate: false }), VERIFIED);
    expect(p.needsSafetyAck).toBe(false);
    expect(p.warnings.join(" ")).toMatch(/simulation could not run/);
  });

  it("still blocks on the plain check when the network cannot simulate and the swap would fail", async () => {
    const p = await plan(fakeDex({ simulate: false, plainCallReverts: true }));
    expect(p.ok).toBe(false);
    expect(p.blocks.join(" ")).toMatch(/The swap would fail/);
  });
});
