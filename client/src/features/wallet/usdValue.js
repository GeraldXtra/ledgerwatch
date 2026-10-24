import http from "../../api/http";

const SYMBOL_TO_COIN_ID = {
  ETH: "ethereum",
  WETH: "ethereum",
  BTC: "bitcoin",
  WBTC: "bitcoin",
  BNB: "binancecoin",
  WBNB: "binancecoin",
  POL: "matic-network",
  WPOL: "matic-network",
  MATIC: "matic-network",
  AVAX: "avalanche-2",
  WAVAX: "avalanche-2",
  USDC: "usd-coin",
  USDT: "tether",
  "USD₮0": "tether",
  USDT0: "tether",
  LINK: "chainlink",

  CBBTC: "bitcoin",
  BTCB: "bitcoin",
  "BTC.B": "bitcoin",

  "WETH.E": "ethereum",
  ARB: "arbitrum",
  OP: "optimism",
  UNI: "uniswap",
  AAVE: "aave",
  CAKE: "pancakeswap-token",

  SOL: "solana",
  WSOL: "solana",
  TRX: "tron",
  WTRX: "tron",
  TON: "the-open-network",
  LTC: "litecoin",
  DOGE: "dogecoin",
  XRP: "ripple",
  ADA: "cardano",
  DOT: "polkadot",
  SHIB: "shiba-inu",
  PEPE: "pepe",
  BCH: "bitcoin-cash",
  JUP: "jupiter-exchange-solana",
  BONK: "bonk",
  RAY: "raydium",
  JTO: "jito-governance-token",
  PYTH: "pyth-network",
  NOT: "notcoin",
  USDE: "ethena-usde",
  DAI: "dai",
};

const STABLE_USD = new Set([
  "USDC",
  "USDC.E",
  "USDT",
  "USDT0",
  "USD₮0",
  "USDBC",
  "DAI",
  "BUSD",
  "TUSD",
  "USDP",
  "FDUSD",
  "PYUSD",
]);

export function stableUsdPrice(symbol) {
  return STABLE_USD.has(String(symbol || "").trim().toUpperCase()) ? 1 : null;
}

export function coinIdForSymbol(symbol) {
  return SYMBOL_TO_COIN_ID[String(symbol || "").trim().toUpperCase()] || null;
}

export function isVerifiedRow(row) {
  return !row || row.verified !== false;
}

export async function fetchUsdPrices(symbols) {
  const list = symbols || [];
  const out = {};

  const needsQuote = [];
  for (const symbol of list) {
    const stable = stableUsdPrice(symbol);
    if (stable != null) out[String(symbol).toUpperCase()] = stable;
    else needsQuote.push(symbol);
  }

  const wanted = [...new Set(needsQuote.map(coinIdForSymbol).filter(Boolean))];
  if (!wanted.length) return out;

  try {
    const { data } = await http.get("/api/prices", { params: { ids: wanted.join(",") } });
    const byId = data?.prices || {};
    for (const symbol of needsQuote) {
      const id = coinIdForSymbol(symbol);
      const usd = id && byId[id] ? Number(byId[id].usd) : null;
      if (Number.isFinite(usd)) out[String(symbol).toUpperCase()] = usd;
    }
  } catch {
  }

  return out;
}

export function totalUsd(rows, prices) {
  let total = 0;
  const unpriced = [];
  const unread = [];

  for (const r of rows || []) {
    if (r.unknown || r.amount == null) {
      unread.push(r.symbol);
      continue;
    }
    if (!isVerifiedRow(r)) {
      if (Number(r.amount) > 0) unpriced.push(r.symbol);
      continue;
    }
    const price = prices[String(r.symbol).toUpperCase()];
    const qty = Number(r.amount);
    if (!Number.isFinite(qty)) continue;
    if (!Number.isFinite(price)) {
      if (qty > 0) unpriced.push(r.symbol);
      continue;
    }
    total += qty * price;
  }

  return { total, unpriced, unread, complete: unpriced.length === 0 && unread.length === 0 };
}
