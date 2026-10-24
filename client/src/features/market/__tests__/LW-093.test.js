import { describe, it, expect, vi, beforeEach } from "vitest";
import { ethers } from "ethers";

vi.mock("../../wallet/provider", async (importOriginal) => ({
  ...(await importOriginal()),
  getProvider: vi.fn(),
}));

import { getProvider } from "../../wallet/provider";
import { buildSwapTx } from "../dex";
import { describeTradeSafety, simulateTrade } from "../tradeSimulation";
import { planSwap } from "../liveSwap";
import { CASH, CHAIN, FROM, TRAP, UNVERIFIED, USDC, fakeDex } from "./fakeDex";

const word = (n) => ethers.toBeHex(n, 32);
const ok = (value) => ({ status: "0x1", returnData: value == null ? "0x" : word(value), gasUsed: "0x1", logs: [] });
const reverted = (message) => ({ status: "0x0", returnData: "0x", gasUsed: "0x1", error: { code: 3, message: `execution reverted: ${message}` } });

const MIN = 99_000_000_000_000_000_000n;

function input({ needsApproval = false } = {}) {
  const quote = { route: { tokens: [USDC, TRAP], fees: [500], via: null } };
  const amountIn = 25_000_000n;
  return {
    chain: CHAIN,
    from: FROM,
    tokenIn: CASH,
    tokenOut: UNVERIFIED,
    amountIn,
    amountOutMinimum: MIN,
    swapTx: buildSwapTx({ chain: CHAIN, quote, amountIn, amountOutMinimum: MIN, recipient: FROM, tokenIn: USDC, tokenOut: TRAP }),
    quote,
    needsApproval,
    sellBack: true,
  };
}

const answering = (results) => ({ send: vi.fn(async () => [{ calls: results }]) });

describe("LW-093 — what the wallet actually receives is measured, not the router's figure", () => {
  it("refuses a token that delivers less than the minimum the router enforces", async () => {
    const delivered = MIN - 1n;
    const provider = answering([ok(7n), ok(), ok(7n + delivered), ok(), ok(0n), ok(), ok(1n)]);
    const safety = await simulateTrade({ provider, ...input() });
    expect(safety).toMatchObject({ checked: true, ok: false, kind: "short-delivery", received: delivered });
    const verdict = describeTradeSafety({ safety, side: "buy", chain: CHAIN, tokenIn: CASH, tokenOut: UNVERIFIED, amountOutMinimum: MIN });
    expect(verdict.blocks[0]).toMatch(/TRAP takes a cut when it is transferred/);
    expect(verdict.blocks[0]).toMatch(/below the 99\.000000 TRAP minimum/);
  });

  it("accepts delivery of exactly the minimum, measured against the balance held before", async () => {
    const provider = answering([ok(5n), ok(), ok(5n + MIN), ok(), ok(0n), ok(), ok(24_000_000n)]);
    const safety = await simulateTrade({ provider, ...input() });
    expect(safety).toMatchObject({ checked: true, ok: true, received: MIN });
  });

  it("reports a buy that fails in the simulation as a failing swap", async () => {
    const provider = answering([ok(0n), reverted("Too little received"), ok(0n), ok(), ok(0n), ok(), ok(0n)]);
    const safety = await simulateTrade({ provider, ...input() });
    expect(safety).toMatchObject({ ok: false, kind: "swap-fails", detail: "Too little received" });
    const verdict = describeTradeSafety({ safety, side: "buy", chain: CHAIN, tokenIn: CASH, tokenOut: UNVERIFIED, amountOutMinimum: MIN });
    expect(verdict.blocks).toEqual(["The swap would fail: Too little received"]);
  });

  it("reports an approval that would fail before the swap is even tried", async () => {
    const provider = answering([reverted("approve from non-zero to non-zero allowance"), ok(0n), ok(), ok(0n), ok(), ok(0n), ok(), ok(0n)]);
    const safety = await simulateTrade({ provider, ...input({ needsApproval: true }) });
    expect(safety).toMatchObject({ ok: false, kind: "approval-fails" });
    const verdict = describeTradeSafety({ safety, side: "buy", chain: CHAIN, tokenIn: CASH, tokenOut: UNVERIFIED, amountOutMinimum: MIN, needsApproval: true });
    expect(verdict.blocks[0]).toMatch(/The approval this trade needs would fail: approve from non-zero to non-zero allowance\./);
    expect(verdict.blocks[0]).not.toMatch(/set to zero first/);
  });

  it("explains a failing approval when an allowance is already in place", () => {
    const safety = { checked: true, ok: false, kind: "approval-fails", detail: "it reverted" };
    const verdict = describeTradeSafety({
      safety,
      side: "buy",
      chain: CHAIN,
      tokenIn: CASH,
      tokenOut: UNVERIFIED,
      amountOutMinimum: MIN,
      needsApproval: true,
      allowance: 10_000_000n,
    });
    expect(verdict.blocks[0]).toMatch(/already allowed to move 10\.000000 USDC/);
    expect(verdict.blocks[0]).toMatch(/set to zero first in a transaction of its own: reset it below, then approve again/);
  });
});

describe("LW-093 — planSwap refuses a fee-on-transfer token", () => {
  beforeEach(() => vi.mocked(getProvider).mockReset());

  const plan = (dex, slippagePct = 1) => {
    vi.mocked(getProvider).mockReturnValue(dex.provider);
    return planSwap({
      chain: CHAIN,
      address: FROM,
      side: "buy",
      tokenIn: CASH,
      tokenOut: UNVERIFIED,
      amountIn: 25_000_000n,
      amountInDisplay: 25,
      slippagePct,
      spentToday: 0,
    });
  };

  it("refuses a 5% transfer fee that slippage would otherwise hide", async () => {
    const p = await plan(fakeDex({ transferFeeBps: 500n }), 1);
    expect(p.ok).toBe(false);
    expect(p.safety).toMatchObject({ kind: "short-delivery" });
    expect(p.blocks.join(" ")).toMatch(/takes a cut when it is transferred/);
  });

  it("refuses a fee small enough to fit inside the slippage, because it then cannot be sold back", async () => {
    const p = await plan(fakeDex({ transferFeeBps: 50n, sellable: false }), 1);
    expect(p.ok).toBe(false);
    expect(p.safety).toMatchObject({ kind: "cannot-sell" });
  });
});
