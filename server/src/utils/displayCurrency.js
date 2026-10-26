const DISPLAY_CURRENCIES = [
  "USD",
  "NGN",
  "EUR",
  "GBP",
  "ZAR",
  "CAD",
  "AUD",
  "INR",
  "JPY",
  "CNY",
  "AED",
  "BRL",
  "CHF",
  "SGD",
  "HKD",
  "MXN",
  "TRY",
  "SAR",
  "KRW",
  "PHP",
  "PKR",
  "IDR",
  "SEK",
  "NOK",
  "PLN",
];

const DEFAULT_DISPLAY_CURRENCY = "USD";

function displayCurrencyOf(value) {
  const code = String(value || "").toUpperCase();
  return DISPLAY_CURRENCIES.includes(code) ? code : DEFAULT_DISPLAY_CURRENCY;
}

module.exports = { DISPLAY_CURRENCIES, DEFAULT_DISPLAY_CURRENCY, displayCurrencyOf };
