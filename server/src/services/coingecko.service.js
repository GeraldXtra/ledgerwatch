const axios = require("axios");

/**
 * CoinGecko data layer — ONE shared cache used by BOTH the automation loop and the
 * API routes (section 4a). The browser may poll often; the server serves from cache
 * and only refreshes from CoinGecko when a per-endpoint TTL expires. A single-flight
 * guard collapses concurrent identical refreshes into one upstream call. On 429 or
 * any failure we serve stale cache, flag `stale:true`, log once (throttled), and
 * never throw.
 */
const API = "https://api.coingecko.com/api/v3";

const MARKETS_TTL = 45 * 1000; // 45s
const CHART_TTL = 5 * 60 * 1000; // 5 min
const SEARCH_TTL = 10 * 60 * 1000; // 10 min
const TIMEOUT = 9000;

// ---- caches ---------------------------------------------------------------
const marketsCache = new Map(); // coinId -> { data, ts }
const chartCache = new Map(); //  "id:days" -> { data, ts }
const searchCache = new Map(); // q(lower) -> { data, ts }

// ---- single-flight --------------------------------------------------------
const inFlight = new Map(); // key -> Promise
function singleFlight(key, fn) {
  if (inFlight.has(key)) return inFlight.get(key);
  const p = (async () => {
    try {
      return await fn();
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, p);
  return p;
}

// ---- throttled error logging (log once per ~60s, not per request) ---------
let lastErrorLogAt = 0;
function logError(scope, err) {
  const now = Date.now();
  if (now - lastErrorLogAt < 60000) return;
  lastErrorLogAt = now;
  const status = err && err.response && err.response.status;
  console.error(
    `CoinGecko ${scope} failed${status ? ` (${status})` : ""}: ${
      err ? err.message : "unknown"
    } — serving cached data`
  );
}

// Map a raw /coins/markets row to a trimmed shape for the UI.
function trimMarket(row) {
  return {
    id: row.id,
    symbol: (row.symbol || "").toUpperCase(),
    name: row.name,
    image: row.image,
    current_price: row.current_price,
    price_change_percentage_24h: row.price_change_percentage_24h_in_currency ??
      row.price_change_percentage_24h ?? null,
    price_change_percentage_7d: row.price_change_percentage_7d_in_currency ?? null,
    market_cap: row.market_cap,
    total_volume: row.total_volume,
    high_24h: row.high_24h,
    low_24h: row.low_24h,
    sparkline:
      row.sparkline_in_7d && Array.isArray(row.sparkline_in_7d.price)
        ? row.sparkline_in_7d.price
        : [],
  };
}

// ---- markets (also the single source for plain prices) --------------------

/**
 * Fetch trimmed market data for the given coin ids. Serves fresh cache, refreshes
 * only stale ids in ONE batched upstream call, keeps stale cache on failure.
 * @returns {Promise<{ markets: Object.<string,object>, stale: boolean, updatedAt: number|null }>}
 */
async function getMarketsMap(coinIds) {
  const ids = [...new Set((coinIds || []).filter(Boolean))];
  if (ids.length === 0) return { markets: {}, stale: false, updatedAt: null };

  const now = Date.now();
  const stale = ids.filter((id) => {
    const e = marketsCache.get(id);
    return !e || now - e.ts > MARKETS_TTL;
  });

  if (stale.length > 0) {
    const key = "markets:" + [...stale].sort().join(",");
    await singleFlight(key, async () => {
      try {
        console.log(`CoinGecko GET markets [${stale.join(",")}]`);
        const { data } = await axios.get(`${API}/coins/markets`, {
          params: {
            vs_currency: "usd",
            ids: stale.join(","),
            sparkline: true,
            price_change_percentage: "24h,7d",
          },
          timeout: TIMEOUT,
        });
        const ts = Date.now();
        for (const row of data || []) {
          if (row && row.id) marketsCache.set(row.id, { data: trimMarket(row), ts });
        }
      } catch (err) {
        logError("markets", err); // keep existing cache
      }
    });
  }

  const markets = {};
  let updatedAt = null;
  let served = 0;
  let servedStale = 0;
  for (const id of ids) {
    const e = marketsCache.get(id);
    if (e) {
      markets[id] = e.data;
      served++;
      if (now - e.ts > MARKETS_TTL) servedStale++;
      updatedAt = updatedAt == null ? e.ts : Math.max(updatedAt, e.ts);
    }
  }
  // stale = we could not fully refresh (some served entries are past TTL, or missing).
  const isStale = servedStale > 0 || served < ids.length;
  return { markets, stale: isStale, updatedAt };
}

/**
 * Adapter kept for existing callers (runPricePass, getPortfolio, approveAlert, chat).
 * Sourced from the SAME markets cache — one fetch path, never two.
 * @returns {Promise<Object.<string,{usd:number}>>}
 */
async function getPrices(coinIds) {
  const { markets } = await getMarketsMap(coinIds);
  const out = {};
  for (const [id, m] of Object.entries(markets)) {
    if (m && typeof m.current_price === "number") out[id] = { usd: m.current_price };
  }
  return out;
}

async function getPrice(coinId) {
  const prices = await getPrices([coinId]);
  return prices[coinId] || null;
}

// ---- chart ----------------------------------------------------------------

/**
 * Historical series for one coin. @returns {{ prices:[[ts,price]], stale, updatedAt }}
 */
async function getChart(coinId, days) {
  const key = `${coinId}:${days}`;
  const now = Date.now();
  const cached = chartCache.get(key);
  const fresh = cached && now - cached.ts <= CHART_TTL;

  if (!fresh) {
    await singleFlight("chart:" + key, async () => {
      try {
        console.log(`CoinGecko GET chart ${coinId} ${days}d`);
        const { data } = await axios.get(`${API}/coins/${coinId}/market_chart`, {
          params: { vs_currency: "usd", days },
          timeout: TIMEOUT,
        });
        chartCache.set(key, {
          data: Array.isArray(data && data.prices) ? data.prices : [],
          ts: Date.now(),
        });
      } catch (err) {
        logError("chart", err);
      }
    });
  }

  const entry = chartCache.get(key);
  if (!entry) return { prices: [], stale: true, updatedAt: null };
  return { prices: entry.data, stale: now - entry.ts > CHART_TTL, updatedAt: entry.ts };
}

// ---- search ---------------------------------------------------------------

/**
 * Coin search (so any coin can be watched). @returns {{ coins:[{id,symbol,name,thumb}], stale }}
 */
async function searchCoins(q) {
  const key = (q || "").trim().toLowerCase();
  if (!key) return { coins: [], stale: false };
  const now = Date.now();
  const cached = searchCache.get(key);
  const fresh = cached && now - cached.ts <= SEARCH_TTL;

  if (!fresh) {
    await singleFlight("search:" + key, async () => {
      try {
        console.log(`CoinGecko GET search "${key}"`);
        const { data } = await axios.get(`${API}/search`, {
          params: { query: key },
          timeout: TIMEOUT,
        });
        const coins = (data && Array.isArray(data.coins) ? data.coins : [])
          .slice(0, 15)
          .map((c) => ({
            id: c.id,
            symbol: (c.symbol || "").toUpperCase(),
            name: c.name,
            thumb: c.thumb,
          }));
        searchCache.set(key, { data: coins, ts: Date.now() });
      } catch (err) {
        logError("search", err);
      }
    });
  }

  const entry = searchCache.get(key);
  if (!entry) return { coins: [], stale: true };
  return { coins: entry.data, stale: now - entry.ts > SEARCH_TTL };
}

// ---- NGN rate for crypto receivables --------------------------------------
const ngnCache = new Map(); // coinId -> { ngn, ts }
const NGN_TTL = 5 * 60 * 1000; // 5 min — an invoice rate does not need to tick

/**
 * Price of a coin in NGN. Used to snapshot the rate when an invoice payment
 * address is issued, so the token amount owed is unambiguous later.
 *
 * Same discipline as the rest of this module: cached, single-flighted, serves
 * stale on failure, and NEVER throws — the caller falls back to a configured
 * rate so address generation cannot hard-fail on a third-party outage.
 *
 * `fetchedAt` is the time the rate was actually RETRIEVED FROM COINGECKO, not the
 * time of this call. A cache hit can be up to NGN_TTL old, and a stale serve can
 * be far older, so returning `Date.now()` here would let the UI tell the user a
 * five minute old rate was fetched this second. The invoice screen displays this
 * age, so it has to be the truth.
 *
 * @returns {Promise<{ngn:number, stale:boolean, fetchedAt:number}|null>}
 */
async function getNgnPrice(coinId = "usd-coin") {
  const now = Date.now();
  const hit = ngnCache.get(coinId);
  if (hit && now - hit.ts < NGN_TTL) return { ngn: hit.ngn, stale: false, fetchedAt: hit.ts };

  await singleFlight(`ngn:${coinId}`, async () => {
    try {
      console.log(`CoinGecko GET simple/price [${coinId} in ngn]`);
      const { data } = await axios.get(`${API}/simple/price`, {
        params: { ids: coinId, vs_currencies: "ngn" },
        timeout: TIMEOUT,
      });
      const ngn = data && data[coinId] && data[coinId].ngn;
      if (typeof ngn === "number" && ngn > 0) ngnCache.set(coinId, { ngn, ts: Date.now() });
    } catch (err) {
      logError("simple/price ngn", err);
    }
  });

  const entry = ngnCache.get(coinId);
  if (!entry) return null; // caller uses its configured fallback
  return {
    ngn: entry.ngn,
    stale: Date.now() - entry.ts > NGN_TTL,
    fetchedAt: entry.ts,
  };
}

module.exports = {
  getMarketsMap,
  getPrices,
  getPrice,
  getChart,
  searchCoins,
  getNgnPrice,
  MARKETS_TTL,
  CHART_TTL,
  SEARCH_TTL,
};
