export function toSpendAmount({ action, denom, amount, price }) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) {
    return { ok: false, reason: "invalid-amount" };
  }

  const wantsQuote = denom === "quote";
  const spendIsCash = action === "buy";

  if (wantsQuote === spendIsCash) {
    return { ok: true, amount: value, converted: false };
  }

  const p = Number(price);
  if (!Number.isFinite(p) || p <= 0) {
    return { ok: false, reason: "no-price" };
  }

  return {
    ok: true,
    amount: spendIsCash ? value * p : value / p,
    converted: true,
  };
}
