import { DEFAULT_CURRENCY, currencyName, isDisplayCurrency } from "./currencies";

const NARROW = new Set([
  "USD",
  "NGN",
  "EUR",
  "GBP",
  "ZAR",
  "INR",
  "JPY",
  "TRY",
  "KRW",
  "PHP",
  "PKR",
  "IDR",
  "PLN",
  "BRL",
]);

const formatters = new Map();

function formatterFor(currency, maximumFractionDigits, signed) {
  const key = `${currency}|${maximumFractionDigits}|${signed ? 1 : 0}`;
  let f = formatters.get(key);
  if (!f) {
    const base = new Intl.NumberFormat("en-US", { style: "currency", currency });
    const standard = base.resolvedOptions().maximumFractionDigits;
    const max = maximumFractionDigits == null ? standard : Math.max(standard, maximumFractionDigits);
    f = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      currencyDisplay: NARROW.has(currency) ? "narrowSymbol" : "symbol",
      minimumFractionDigits: Math.min(standard, max),
      maximumFractionDigits: max,
      signDisplay: signed ? "exceptZero" : "auto",
    });
    formatters.set(key, f);
  }
  return f;
}

export function resolveDisplay(wanted, rates) {
  const code = isDisplayCurrency(wanted) ? wanted : DEFAULT_CURRENCY;
  if (code === DEFAULT_CURRENCY) {
    return { currency: DEFAULT_CURRENCY, wanted: code, rate: 1, fellBack: false };
  }
  const rate = rates ? Number(rates[code]) : NaN;
  if (Number.isFinite(rate) && rate > 0) {
    return { currency: code, wanted: code, rate, fellBack: false };
  }
  return { currency: DEFAULT_CURRENCY, wanted: code, rate: 1, fellBack: true };
}

export function convertUsd(usd, display) {
  const n = Number(usd);
  if (usd == null || !Number.isFinite(n)) return null;
  const rate = display && Number.isFinite(display.rate) && display.rate > 0 ? display.rate : 1;
  return n * rate;
}

function priceDigits(abs) {
  if (abs === 0 || abs >= 1) return null;
  if (abs >= 0.01) return 4;
  return 6;
}

export function formatMoney(usd, display, { signed = false, price = false } = {}) {
  const value = convertUsd(usd, display);
  if (value == null) return "--";
  const currency = (display && display.currency) || DEFAULT_CURRENCY;
  const digits = price ? priceDigits(Math.abs(value)) : null;
  const clean = Object.is(value, -0) ? 0 : value;
  return formatterFor(currency, digits, signed).format(clean);
}

export function fallbackNote(display) {
  if (!display || !display.fellBack) return "";
  return `The ${currencyName(display.wanted)} rate could not be loaded just now, so values are shown in US dollars.`;
}
