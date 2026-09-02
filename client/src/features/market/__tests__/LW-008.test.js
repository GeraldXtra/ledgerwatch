import { describe, it, expect } from "vitest";
import { toSpendAmount } from "../amount";

/**
 * LW-008 — the live trade discarded the chosen denomination.
 *
 * The original line was `denom === "quote" ? amount : amount`. Every case below
 * that says "converted" passed silently before the fix, sending the raw typed
 * number to `parseUnits` with the spend token's decimals.
 *
 * The fourth test is the one that mattered: selling with a USD figure sent the
 * number straight through as an ASSET quantity, so "sell 100 dollars of WETH"
 * became "sell 100 WETH".
 */
describe("LW-008 trade amount denomination", () => {
  const PRICE = 3200; // USD per WETH

  it("buy priced in USD spends that USD, unconverted", () => {
    // Spend side is cash, unit typed is cash. Nothing to do.
    const r = toSpendAmount({ action: "buy", denom: "quote", amount: 100, price: PRICE });
    expect(r).toMatchObject({ ok: true, amount: 100, converted: false });
  });

  it("buy priced in the asset converts to USD before spending", () => {
    // "Buy 0.5 WETH" must spend 0.5 * 3200 = 1600 USDC, not 0.5 USDC.
    const r = toSpendAmount({ action: "buy", denom: "token", amount: 0.5, price: PRICE });
    expect(r.ok).toBe(true);
    expect(r.converted).toBe(true);
    expect(r.amount).toBeCloseTo(1600, 8);
  });

  it("sell priced in the asset spends that asset, unconverted", () => {
    const r = toSpendAmount({ action: "sell", denom: "token", amount: 0.5, price: PRICE });
    expect(r).toMatchObject({ ok: true, amount: 0.5, converted: false });
  });

  it("sell priced in USD converts to the asset, the wallet emptying case", () => {
    // "Sell 100 dollars of WETH" is 0.03125 WETH. The bug sent 100 WETH.
    const r = toSpendAmount({ action: "sell", denom: "quote", amount: 100, price: PRICE });
    expect(r.ok).toBe(true);
    expect(r.amount).toBeCloseTo(100 / PRICE, 12);
    expect(r.amount).toBeLessThan(1); // never anywhere near the typed 100
  });

  it("refuses to convert with no usable price rather than guessing", () => {
    for (const price of [0, null, undefined, NaN, -5]) {
      expect(toSpendAmount({ action: "sell", denom: "quote", amount: 100, price })).toMatchObject({
        ok: false,
        reason: "no-price",
      });
    }
  });

  it("still passes through when no conversion is needed and price is missing", () => {
    // A same-unit trade does not need a price, so a missing one must not block it.
    const r = toSpendAmount({ action: "buy", denom: "quote", amount: 250, price: null });
    expect(r).toMatchObject({ ok: true, amount: 250, converted: false });
  });

  it("rejects amounts that are not positive numbers", () => {
    for (const amount of [0, -1, "", "abc", null, undefined, NaN]) {
      expect(toSpendAmount({ action: "buy", denom: "quote", amount, price: PRICE }).ok).toBe(false);
    }
  });
});
