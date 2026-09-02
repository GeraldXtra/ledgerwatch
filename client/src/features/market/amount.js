/**
 * Convert a typed trade amount into the unit that will actually be SPENT.
 *
 * LW-008. This lived inline in `MarketWatchPage.submitTrade` as
 * `denom === "quote" ? amount : amount` — both branches identical, so whichever
 * unit the user picked was discarded and the raw number went to `parseUnits`
 * with the decimals of the spend token.
 *
 * The failure was not cosmetic. Choosing "USD value" on a sell and typing 100,
 * meaning a hundred dollars, parsed as ONE HUNDRED WETH. On a testnet that costs
 * nothing. On mainnet it is the wallet.
 *
 * The rule is one line: a buy spends CASH, a sell spends the ASSET. If the unit
 * typed is not the unit spent, convert through the price.
 *
 * Extracted so it can be tested. The bug survived review precisely because it
 * looked like a ternary doing something.
 */
export function toSpendAmount({ action, denom, amount, price }) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) {
    return { ok: false, reason: "invalid-amount" };
  }

  const wantsQuote = denom === "quote"; // the user typed a USD figure
  const spendIsCash = action === "buy"; // a buy spends the stablecoin

  if (wantsQuote === spendIsCash) {
    // Already in the unit that leaves the wallet.
    return { ok: true, amount: value, converted: false };
  }

  const p = Number(price);
  if (!Number.isFinite(p) || p <= 0) {
    // Refuse rather than guess. A conversion with no price is how the wrong
    // number reaches a signature.
    return { ok: false, reason: "no-price" };
  }

  return {
    ok: true,
    amount: spendIsCash ? value * p : value / p,
    converted: true,
  };
}
