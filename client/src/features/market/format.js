export function usd(n) {
  if (n == null || isNaN(n)) return "--";
  return `$${Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

export function num(n, max = 6) {
  if (n == null || isNaN(n)) return "--";
  return Number(n).toLocaleString("en-US", { maximumFractionDigits: max });
}

export function signedUsd(n) {
  if (n == null || isNaN(n)) return "--";
  const sign = n >= 0 ? "+" : "-";
  return `${sign}$${Math.abs(Number(n)).toLocaleString("en-US", {
    maximumFractionDigits: 2,
  })}`;
}

// Adaptive price: more decimals for sub-$1 coins so they don't read as "$0.00".
export function price(n) {
  if (n == null || isNaN(n)) return "--";
  const v = Number(n);
  const abs = Math.abs(v);
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6;
  return `$${v.toLocaleString("en-US", { maximumFractionDigits: digits })}`;
}

// Compact large figures: $1.2B, $920.4M, $12.3K.
export function compact(n) {
  if (n == null || isNaN(n)) return "--";
  const v = Number(n);
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

// Signed percentage: +2.14% / -0.87%.
export function pct(n) {
  if (n == null || isNaN(n)) return "--";
  const v = Number(n);
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

const CONDITION_LABEL = {
  drop_pct: (v) => `drops ${v}%`,
  rise_pct: (v) => `rises ${v}%`,
  price_below: (v) => `price below $${num(v, 2)}`,
  price_above: (v) => `price above $${num(v, 2)}`,
};

export function conditionText(condition) {
  if (!condition) return "";
  const fn = CONDITION_LABEL[condition.type];
  return fn ? fn(condition.value) : `${condition.type} ${condition.value}`;
}
