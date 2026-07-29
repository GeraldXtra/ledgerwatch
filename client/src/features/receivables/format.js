// Shared formatting for the Receivables module.
//
// Amounts run to enterprise scale (past ₦100,000,000,000). Precision is safe:
// these are whole naira held as IEEE-754 doubles, and 1e11 sits far below the
// 2^53 integer-safe ceiling, so nothing is lost. The real problem at that size
// is LAYOUT — hence two formatters:
//   ngn()        full precision, for tables, detail views, receipts and tooltips
//   compactNgn() ₦125.4M / ₦1.2B, for KPI cards, chart axes and narrow cells
// The ₦ symbol is used throughout: it is correct, and it buys back the width
// that large figures need.

const NAIRA = "₦";

export function ngn(amount, symbol = NAIRA) {
  const n = Number(amount) || 0;
  return `${symbol}${n.toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;
}

// Whole-naira variant for CountUp: the animation feeds fractional intermediate
// values, which would otherwise render as "₦48,213.74" mid-flight. Amounts in
// this app are whole naira, so the resting value is unchanged.
export function ngnWhole(amount, symbol = NAIRA) {
  return ngn(Math.round(Number(amount) || 0), symbol);
}

/**
 * Compact form for tight spaces. One decimal reads better at a glance than two
 * and keeps KPI cards from overflowing: ₦125.4M, ₦1.2B, ₦96.4M.
 */
export function compactNgn(amount, symbol = NAIRA) {
  const v = Number(amount) || 0;
  const abs = Math.abs(v);
  if (abs >= 1e12) return `${symbol}${(v / 1e12).toFixed(1)}T`;
  if (abs >= 1e9) return `${symbol}${(v / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${symbol}${(v / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${symbol}${Math.round(v / 1e3)}K`;
  return `${symbol}${Math.round(v).toLocaleString("en-NG")}`;
}

/**
 * KPI figures: compact once the number would be too wide to sit comfortably at
 * display size, full precision below that. Keeps the most-looked-at element
 * readable at any scale without truncating or shrinking the type.
 */
export function kpiNgn(amount) {
  const v = Number(amount) || 0;
  return Math.abs(v) >= 1e6 ? compactNgn(v) : ngnWhole(v);
}

export function shortDate(value) {
  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function dateTime(value) {
  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value);
  return d.toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

// Reliability band -> semantic tone class (pos/neg/warn/neutral).
export function bandTone(band) {
  switch (band) {
    case "Excellent":
      return "pos";
    case "Good":
      return "pos";
    case "Fair":
      return "warn";
    case "Risky":
      return "neg";
    default:
      return "neutral"; // New
  }
}

export const METHOD_LABEL = { cash: "Cash", transfer: "Transfer", other: "Other" };
