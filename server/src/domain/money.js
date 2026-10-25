const KOBO_PER_NAIRA = 100;
const MAX_NAIRA = 1000000000000;
const RATE_SCALE = 1000000n;
const PPM = 1000000n;

function moneyError(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

function finiteNumber(value, label) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) throw moneyError(`${label} is not a number.`);
  return n;
}

function nairaToKobo(naira) {
  const n = finiteNumber(naira, "The amount");
  const kobo = Math.round(n * KOBO_PER_NAIRA);
  if (!Number.isSafeInteger(kobo)) throw moneyError("The amount is too large.");
  return kobo;
}

function hasWholeKobo(naira) {
  const n = Number(naira);
  if (!Number.isFinite(n)) return false;
  return Math.abs(n * KOBO_PER_NAIRA - Math.round(n * KOBO_PER_NAIRA)) < 1e-6;
}

function koboToNaira(kobo) {
  return Number(kobo) / KOBO_PER_NAIRA;
}

function koboOf(doc, field = "amount") {
  if (!doc) return 0;
  const stored = doc[`${field}Kobo`];
  if (Number.isSafeInteger(stored)) return stored;
  const legacy = doc[field];
  return legacy == null ? 0 : nairaToKobo(legacy);
}

function sumKobo(docs, field = "amount") {
  return (docs || []).reduce((sum, doc) => sum + koboOf(doc, field), 0);
}

function toUnits(raw) {
  if (typeof raw === "bigint") return raw;
  if (raw == null || raw === "") return 0n;
  if (typeof raw === "number") {
    if (!Number.isSafeInteger(raw) || raw < 0) throw moneyError("A base-unit amount must be a whole number.");
    return BigInt(raw);
  }
  const s = String(raw).trim();
  if (/^0x[0-9a-f]+$/i.test(s)) return BigInt(s);
  if (/^\d+$/.test(s)) return BigInt(s);
  throw moneyError("A base-unit amount must be a whole number.");
}

function decimalText(value, decimals) {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw moneyError("The amount is not a number.");
    return value.toFixed(Math.min(decimals, 100));
  }
  const s = String(value).trim();
  if (/^[-+]?(\d+\.?\d*|\.\d+)$/.test(s)) return s;
  const n = Number(s);
  if (!Number.isFinite(n)) throw moneyError("The amount is not a number.");
  return n.toFixed(Math.min(decimals, 100));
}

function decimalToUnits(value, decimals) {
  const d = Number(decimals);
  if (!Number.isInteger(d) || d < 0 || d > 36) throw moneyError("The token has an unusable number of decimals.");
  let s = decimalText(value, d);
  let negative = false;
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1);
  } else if (s.startsWith("+")) {
    s = s.slice(1);
  }
  const [whole = "0", fraction = ""] = s.split(".");
  const kept = (fraction + "0".repeat(d)).slice(0, d);
  const roundUp = fraction.length > d && Number(fraction[d]) >= 5;
  let units = BigInt(whole || "0") * 10n ** BigInt(d) + BigInt(kept || "0");
  if (roundUp) units += 1n;
  return negative ? -units : units;
}

function unitsToDecimalString(units, decimals) {
  const value = toUnits(units);
  const d = BigInt(decimals);
  const divisor = 10n ** d;
  const whole = value / divisor;
  const fraction = value % divisor;
  if (fraction === 0n) return whole.toString();
  return `${whole}.${fraction.toString().padStart(Number(d), "0").replace(/0+$/, "")}`;
}

function unitsToNumber(units, decimals) {
  return Number(unitsToDecimalString(units, decimals));
}

function rateToScaled(ngnPerUsd) {
  const rate = finiteNumber(ngnPerUsd, "The exchange rate");
  if (!(rate > 0)) throw moneyError("The exchange rate must be above zero.");
  return BigInt(Math.round(rate * Number(RATE_SCALE)));
}

function divideRoundHalfUp(numerator, denominator) {
  return (numerator * 2n + denominator) / (denominator * 2n);
}

function divideCeil(numerator, denominator) {
  return (numerator + denominator - 1n) / denominator;
}

function unitsToKobo(units, decimals, ngnPerUsd) {
  const value = toUnits(units);
  const scaled = rateToScaled(ngnPerUsd);
  const numerator = value * scaled * BigInt(KOBO_PER_NAIRA);
  const denominator = 10n ** BigInt(decimals) * RATE_SCALE;
  return Number(divideRoundHalfUp(numerator, denominator));
}

function koboToUsdCents(kobo, ngnPerUsd) {
  const k = BigInt(Math.max(0, Math.round(Number(kobo) || 0)));
  if (k === 0n) return 0;
  return Number(divideCeil(k * RATE_SCALE, rateToScaled(ngnPerUsd)));
}

function centsToUnits(cents, decimals) {
  const d = Number(decimals);
  const c = BigInt(Math.max(0, Math.round(Number(cents) || 0)));
  return d >= 2 ? c * 10n ** BigInt(d - 2) : divideCeil(c, 10n ** BigInt(2 - d));
}

function fractionToPpm(fraction) {
  const n = Number(fraction);
  if (!Number.isFinite(n) || n < 0) return 0n;
  return BigInt(Math.round(n * Number(PPM)));
}

function shareOf(value, fraction) {
  return (toUnits(value) * fractionToPpm(fraction)) / PPM;
}

function minUnits(a, b) {
  return a < b ? a : b;
}

function maxUnits(a, b) {
  return a > b ? a : b;
}

module.exports = {
  KOBO_PER_NAIRA,
  MAX_NAIRA,
  nairaToKobo,
  hasWholeKobo,
  koboToNaira,
  koboOf,
  sumKobo,
  toUnits,
  decimalToUnits,
  unitsToDecimalString,
  unitsToNumber,
  unitsToKobo,
  koboToUsdCents,
  centsToUnits,
  shareOf,
  minUnits,
  maxUnits,
};
