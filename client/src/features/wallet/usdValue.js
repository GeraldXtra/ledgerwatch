import http from "../../api/http";

/**
 * Price wallet holdings in USD.
 *
 * WHY A MAP AND NOT JUST THE SYMBOL
 *
 * A wallet holds WRAPPED tokens. WETH is not a coin CoinGecko lists next to
 * ether, it is an ERC-20 that is worth exactly one ETH, and the same is true of
 * WBNB, WPOL, WAVAX and WBTC. Pricing by the raw symbol would leave every
 * wrapped balance at zero, which is the same failure as an unread balance
 * rendering as zero: the number looks real and is wrong.
 *
 * Arbitrum's USDT self identifies as USD₮0, which is why that oddity is in here
 * rather than being "handled" by a substring match that would also catch things
 * it should not.
 */
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

  /**
   * The wrapped bitcoins, each priced as bitcoin because each is held one for
   * one against it. Getting this wrong would leave a real holding showing as
   * unpriced and quietly missing from the wallet total, which is the same class
   * of wrong number as rendering an unread balance as zero.
   *
   * Keys are uppercase because coinIdForSymbol uppercases its input, so the
   * contract symbols cbBTC and BTC.b appear here as CBBTC and BTC.B.
   */
  CBBTC: "bitcoin",
  BTCB: "bitcoin",
  "BTC.B": "bitcoin",

  "WETH.E": "ethereum",
  ARB: "arbitrum",
  OP: "optimism",
  UNI: "uniswap",
  AAVE: "aave",
  CAKE: "pancakeswap-token",
};

export function coinIdForSymbol(symbol) {
  return SYMBOL_TO_COIN_ID[String(symbol || "").trim().toUpperCase()] || null;
}

/**
 * Fetch USD prices for a set of wallet symbols.
 *
 * Returns a map keyed by the SYMBOL the wallet uses, so a caller never has to
 * think about coin ids. A symbol with no mapping is simply absent, and the
 * caller must render that as unpriced rather than as zero.
 */
export async function fetchUsdPrices(symbols) {
  const wanted = [...new Set(symbols.map(coinIdForSymbol).filter(Boolean))];
  if (!wanted.length) return {};

  const { data } = await http.get("/api/prices", { params: { ids: wanted.join(",") } });
  const byId = data?.prices || {};

  const out = {};
  for (const symbol of symbols) {
    const id = coinIdForSymbol(symbol);
    const usd = id && byId[id] ? Number(byId[id].usd) : null;
    if (Number.isFinite(usd)) out[String(symbol).toUpperCase()] = usd;
  }
  return out;
}

/**
 * Total a set of balance rows in USD.
 *
 * Returns the total ALONGSIDE what could not be counted, rather than a single
 * number that quietly omits things. A total that silently excludes an unread or
 * unpriced holding is a wrong number presented as a right one, and this app has
 * a rule about that. The caller shows the caveat.
 */
export function totalUsd(rows, prices) {
  let total = 0;
  const unpriced = [];
  const unread = [];

  for (const r of rows || []) {
    if (r.unknown || r.amount == null) {
      unread.push(r.symbol);
      continue;
    }
    const price = prices[String(r.symbol).toUpperCase()];
    const qty = Number(r.amount);
    if (!Number.isFinite(qty)) continue;
    if (!Number.isFinite(price)) {
      // Only worth mentioning if they actually hold some of it.
      if (qty > 0) unpriced.push(r.symbol);
      continue;
    }
    total += qty * price;
  }

  return { total, unpriced, unread, complete: unpriced.length === 0 && unread.length === 0 };
}
