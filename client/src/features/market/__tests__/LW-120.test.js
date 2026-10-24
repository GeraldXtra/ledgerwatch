import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../wallet/provider", async (importOriginal) => ({
  ...(await importOriginal()),
  getProvider: vi.fn(),
}));

import { getProvider } from "../../wallet/provider";
import { planSwap } from "../liveSwap";
import { CASH, CHAIN, FROM, UNVERIFIED, fakeDex } from "./fakeDex";

const plan = (dex) => {
  vi.mocked(getProvider).mockReturnValue(dex.provider);
  return planSwap({
    chain: CHAIN,
    address: FROM,
    side: "buy",
    tokenIn: CASH,
    tokenOut: UNVERIFIED,
    amountIn: 25_000_000n,
    amountInDisplay: 25,
    slippagePct: 1,
    spentToday: 0,
  });
};

describe("LW-120 — a token that refuses to change a non-zero allowance gets a reset step", () => {
  beforeEach(() => vi.mocked(getProvider).mockReset());

  it("offers the reset when an allowance exists and the approval would fail", async () => {
    const p = await plan(fakeDex({ allowance: 5_000_000n, approveReverts: true }));
    expect(p.needsApproval).toBe(true);
    expect(p.ok).toBe(false);
    expect(p.needsAllowanceReset).toBe(true);
    expect(p.blocks.join(" ")).toMatch(/already allowed to move 5\.000000 USDC.*reset it below, then approve again/s);
  });

  it("does not offer it when there is no allowance to reset", async () => {
    const p = await plan(fakeDex({ allowance: 0n, approveReverts: true }));
    expect(p.needsAllowanceReset).toBe(false);
    expect(p.blocks.join(" ")).toMatch(/The approval this trade needs would fail/);
  });

  it("does not offer it when the approval would go through", async () => {
    const p = await plan(fakeDex({ allowance: 5_000_000n }));
    expect(p.needsApproval).toBe(true);
    expect(p.needsAllowanceReset).toBe(false);
    expect(p.ok).toBe(true);
  });
});
