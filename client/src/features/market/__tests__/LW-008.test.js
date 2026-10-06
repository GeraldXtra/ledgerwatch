import { describe, it, expect } from "vitest";
import { toSpendAmount } from "../amount";

describe("LW-008 trade amount denomination", () => {
  const PRICE = 3200;

  it("buy priced in USD spends that USD, unconverted", () => {
    const r = toSpendAmount({ action: "buy", denom: "quote", amount: 100, price: PRICE });
    expect(r).toMatchObject({ ok: true, amount: 100, converted: false });
  });

  it("buy priced in the asset converts to USD before spending", () => {
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
    const r = toSpendAmount({ action: "sell", denom: "quote", amount: 100, price: PRICE });
    expect(r.ok).toBe(true);
    expect(r.amount).toBeCloseTo(100 / PRICE, 12);
    expect(r.amount).toBeLessThan(1);
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
    const r = toSpendAmount({ action: "buy", denom: "quote", amount: 250, price: null });
    expect(r).toMatchObject({ ok: true, amount: 250, converted: false });
  });

  it("rejects amounts that are not positive numbers", () => {
    for (const amount of [0, -1, "", "abc", null, undefined, NaN]) {
      expect(toSpendAmount({ action: "buy", denom: "quote", amount, price: PRICE }).ok).toBe(false);
    }
  });
});
