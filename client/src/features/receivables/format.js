// Shared formatting for the Receivables module.

export function ngn(amount, currency = "NGN") {
  const n = Number(amount) || 0;
  return `${currency} ${n.toLocaleString("en-NG")}`;
}

// Whole-naira variant for CountUp: the animation feeds fractional intermediate
// values, and `toLocaleString("en-NG")` would render them as "NGN 48,213.738".
// Naira amounts in this app are whole, so the resting value is unchanged.
export function ngnWhole(amount, currency = "NGN") {
  return ngn(Math.round(Number(amount) || 0), currency);
}

export function compactNgn(amount, currency = "NGN") {
  const v = Number(amount) || 0;
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${currency} ${(v / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${currency} ${(v / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${currency} ${(v / 1e3).toFixed(1)}K`;
  return `${currency} ${v.toLocaleString("en-NG")}`;
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
