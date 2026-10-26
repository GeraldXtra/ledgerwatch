export const DISPLAY_CURRENCIES = [
  { code: "USD", name: "US dollar" },
  { code: "NGN", name: "Nigerian naira" },
  { code: "EUR", name: "Euro" },
  { code: "GBP", name: "British pound" },
  { code: "ZAR", name: "South African rand" },
  { code: "CAD", name: "Canadian dollar" },
  { code: "AUD", name: "Australian dollar" },
  { code: "INR", name: "Indian rupee" },
  { code: "JPY", name: "Japanese yen" },
  { code: "CNY", name: "Chinese yuan" },
  { code: "AED", name: "UAE dirham" },
  { code: "BRL", name: "Brazilian real" },
  { code: "CHF", name: "Swiss franc" },
  { code: "SGD", name: "Singapore dollar" },
  { code: "HKD", name: "Hong Kong dollar" },
  { code: "MXN", name: "Mexican peso" },
  { code: "TRY", name: "Turkish lira" },
  { code: "SAR", name: "Saudi riyal" },
  { code: "KRW", name: "South Korean won" },
  { code: "PHP", name: "Philippine peso" },
  { code: "PKR", name: "Pakistani rupee" },
  { code: "IDR", name: "Indonesian rupiah" },
  { code: "SEK", name: "Swedish krona" },
  { code: "NOK", name: "Norwegian krone" },
  { code: "PLN", name: "Polish zloty" },
];

export const DEFAULT_CURRENCY = "USD";

const CODES = new Set(DISPLAY_CURRENCIES.map((c) => c.code));

export function isDisplayCurrency(code) {
  return CODES.has(String(code || ""));
}

export function currencyOf(user) {
  const code = String((user && user.displayCurrency) || "").toUpperCase();
  return CODES.has(code) ? code : DEFAULT_CURRENCY;
}

export function currencyName(code) {
  const hit = DISPLAY_CURRENCIES.find((c) => c.code === code);
  return hit ? hit.name : code;
}
