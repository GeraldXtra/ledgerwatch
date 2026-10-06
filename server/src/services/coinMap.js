const SYMBOL_TO_ID = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  BNB: "binancecoin",
  USDT: "tether",
  USDC: "usd-coin",
  XRP: "ripple",
  ADA: "cardano",
  DOGE: "dogecoin",
  MATIC: "matic-network",
  DOT: "polkadot",
  LTC: "litecoin",
  TRX: "tron",
  AVAX: "avalanche-2",
  LINK: "chainlink",
};

const ID_TO_SYMBOL = Object.entries(SYMBOL_TO_ID).reduce((acc, [sym, id]) => {
  acc[id] = sym;
  return acc;
}, {});

function resolveSymbol(input) {
  if (!input || typeof input !== "string") return null;
  const symbol = input.trim().toUpperCase();
  const coinId = SYMBOL_TO_ID[symbol];
  if (!coinId) return null;
  return { symbol, coinId };
}

function symbolForId(coinId) {
  return ID_TO_SYMBOL[coinId] || coinId;
}

function isSupportedSymbol(input) {
  return resolveSymbol(input) !== null;
}

function supportedSymbols() {
  return Object.keys(SYMBOL_TO_ID);
}

module.exports = {
  SYMBOL_TO_ID,
  resolveSymbol,
  symbolForId,
  isSupportedSymbol,
  supportedSymbols,
};
