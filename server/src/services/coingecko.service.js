const axios = require("axios");

/**
 * CoinGecko data layer — ONE shared cache used by BOTH the automation loop and the
 * API routes (section 4a). The browser may poll often; the server serves from cache
 * and only refreshes from CoinGecko when a per-endpoint TTL expires. A single-flight
 * guard collapses concurrent identical refreshes into one upstream call. On 429 or
 * any failure we serve stale cache, flag `stale:true`, log once (throttled), and
 * never throw.
 */
const TIMEOUT = 9000;

/**
 * TTLs, AND WHY THEY ARE NOT CONSTANTS ANY MORE.
 *
 * These were tuned for a laptop with a developer's own allowance. In production
 * the browser polls /api/markets every ten seconds, so a 45 second markets TTL
 * is about eighty upstream calls an hour for that endpoint alone, before charts,
 * logos, coin search and the invoice rate. An authenticated key absorbs that
 * comfortably. A keyless request does not: the free allowance is per IP, it is
 * small, and on a shared datacenter IP most of it is already spent by somebody
 * else before this app asks for anything.
 *
 * So when there is no key the TTLs widen. That is not a degraded mode for its
 * own sake — it is the difference between a cache that refills and one that gets
 * refused on every attempt and therefore stays empty, which is what makes every
 * price, logo and chart blank at once. A price a couple of minutes old beats no
 * price at all, and a chart is historical data that barely moves.
 *
 * Set COINGECKO_API_KEY and the tighter numbers apply automatically.
 */
const KEYLESS_TTL_FACTOR = 4;

function ttlFactor() {
  return cgConfig().keyed ? 1 : KEYLESS_TTL_FACTOR;
}

const BASE_MARKETS_TTL = 45 * 1000; // 45s keyed, 3 min keyless
const BASE_CHART_TTL = 5 * 60 * 1000; // 5 min keyed, 20 min keyless
const BASE_SEARCH_TTL = 10 * 60 * 1000; // 10 min keyed, 40 min keyless

const marketsTtl = () => BASE_MARKETS_TTL * ttlFactor();
const chartTtl = () => BASE_CHART_TTL * ttlFactor();
const searchTtl = () => BASE_SEARCH_TTL * ttlFactor();

/**
 * Exported for callers that report cache age. These keep the keyed values so a
 * consumer's arithmetic does not change shape; the live TTL is read through the
 * functions above.
 */
const MARKETS_TTL = BASE_MARKETS_TTL;
const CHART_TTL = BASE_CHART_TTL;
const SEARCH_TTL = BASE_SEARCH_TTL;

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

  /**
   * A pause is not a failure and must not be reported as one.
   *
   * When the breaker is open, cgGet throws without going near the network. Left
   * to the line below, that would print "CoinGecko markets failed: paused for
   * 240s" once a minute, which reads as the upstream refusing us again and
   * hides the fact that the ORIGINAL refusal is the thing to fix.
   */
  if (err && err.cgPaused) {
    console.warn(`CoinGecko ${scope} skipped — ${err.message}. Serving cached data.`);
    return;
  }

  const status = err && err.response && err.response.status;
  console.error(
    `CoinGecko ${scope} failed${status ? ` (${status})` : ""}: ${
      err ? err.message : "unknown"
    } — serving cached data`
  );
  // The single most common cause in production, and not guessable from the
  // status alone, so it is said out loud next to the failure rather than left
  // for somebody to rediscover.
  if (isRefusal(status) && !cgConfig().keyed) {
    console.error(
      "CoinGecko refused an unauthenticated request. Hosted IPs are rate limited " +
        "far below a laptop's allowance — set COINGECKO_API_KEY (and " +
        "COINGECKO_PLAN=pro for a Pro key). Prices, coin logos, charts and coin " +
        "search all read this one upstream, so they go dark together."
    );
  }
}

// ---- upstream transport ----------------------------------------------------

/**
 * THE ONE PLACE THIS PROCESS TALKS TO COINGECKO.
 *
 * WHY THIS EXISTS. Every call used to be a bare `axios.get` against
 * `api.coingecko.com` with no API key. That works from a laptop and fails on a
 * host: CoinGecko rate limits the keyless endpoint hard, and shared datacenter
 * IPs (Render, Railway, Fly, Vercel, AWS) burn the quota long before this app
 * asks for anything. The failure was invisible in exactly the way section 12
 * warns about, because every caller swallows its own error and serves cache —
 * and on a fresh deploy the cache is EMPTY, so "serve stale" served nothing.
 *
 * The visible symptom was the whole market surface going dark at once: no live
 * price, no coin logos (they are the `image` field of the same markets row), no
 * chart, and no coin search. Four separate-looking bugs, one cause.
 *
 * Set COINGECKO_API_KEY. A demo key goes to api.coingecko.com with the
 * `x-cg-demo-api-key` header; a Pro key needs COINGECKO_PLAN=pro, which switches
 * the host to pro-api.coingecko.com and the header to `x-cg-pro-api-key`.
 * Sending a demo key to the pro host, or the reverse, is a 401 — hence one
 * function deciding both together rather than two settings that can disagree.
 */
function cgConfig() {
  const key = String(process.env.COINGECKO_API_KEY || "").trim();
  const pro = String(process.env.COINGECKO_PLAN || "").trim().toLowerCase() === "pro";
  if (!key) return { base: "https://api.coingecko.com/api/v3", headers: {}, keyed: false };
  return pro
    ? {
        base: "https://pro-api.coingecko.com/api/v3",
        headers: { "x-cg-pro-api-key": key },
        keyed: true,
      }
    : {
        base: "https://api.coingecko.com/api/v3",
        headers: { "x-cg-demo-api-key": key },
        keyed: true,
      };
}

/**
 * A CIRCUIT BREAKER, because retrying a 429 is what turns a slow hour into a
 * dead one.
 *
 * There was no 429 handling at all. Under a sustained rate limit every request
 * from every browser tab, plus the automation loop, kept hammering the endpoint
 * that was already refusing us — which is precisely how a temporary limit
 * becomes a permanent one. When CoinGecko says no, we stop asking until it is
 * plausibly worth asking again, and serve cache in the meantime.
 *
 * `Retry-After` is honoured when sent, because it is the upstream telling us the
 * answer; otherwise the wait doubles from 15s to a 5 minute ceiling. Any success
 * clears it, so recovery is immediate rather than waiting out the last backoff.
 */
const MIN_BACKOFF_MS = 15 * 1000;
const MAX_BACKOFF_MS = 5 * 60 * 1000;
let blockedUntil = 0;
let backoffMs = 0;

/** Refusals that mean "stop asking", as opposed to a one-off network blip. */
function isRefusal(status) {
  return status === 429 || status === 401 || status === 403 || status === 451;
}

function noteFailure(err) {
  const status = err && err.response && err.response.status;
  if (!isRefusal(status)) return; // a timeout or 5xx is worth retrying next tick
  const headers = (err.response && err.response.headers) || {};
  const retryAfter = Number(headers["retry-after"]);
  const wait =
    Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.min(MAX_BACKOFF_MS, retryAfter * 1000)
      : Math.min(MAX_BACKOFF_MS, backoffMs ? backoffMs * 2 : MIN_BACKOFF_MS);
  backoffMs = wait;
  blockedUntil = Date.now() + wait;
}

/**
 * The last thing the upstream actually said, so a blank screen can be explained
 * instead of guessed at.
 *
 * Every price, coin logo and chart in this product comes from one provider, and
 * when it stops answering all three go blank at once with nothing on screen or
 * in the API saying why. Diagnosing that from the outside meant reading server
 * logs, which is not available on most hosts and is not something the owner
 * should need. This records the outcome of the most recent call so
 * `GET /api/status` can state the cause in one line.
 *
 * Deliberately holds no URL and no key — only a status code and the provider's
 * own message, both of which are safe to show.
 */
let lastUpstream = null; // { at, ok, status, message }

function noteUpstream(ok, err) {
  lastUpstream = {
    at: Date.now(),
    ok,
    status: (err && err.response && err.response.status) || null,
    message: ok ? null : (err && err.message) || "unknown",
  };
}

/**
 * @returns {object} for the boot log, and for GET /api/status, which is how a
 * human finds out why the market screens are empty.
 */
function cgStatus() {
  const { keyed } = cgConfig();
  const paused = Math.max(0, blockedUntil - Date.now());
  return {
    configured: keyed,
    plan: keyed ? String(process.env.COINGECKO_PLAN || "demo").trim().toLowerCase() : "none",
    pausedForMs: paused,
    cachedCoins: marketsCache.size,
    cachedCharts: chartCache.size,
    lastUpstream,
    /**
     * The whole diagnosis in one sentence, because the fields above still need
     * somebody to know what they imply.
     */
    diagnosis: (() => {
      if (lastUpstream && lastUpstream.ok) return "Upstream healthy.";
      if (!lastUpstream) return "No upstream call made yet since this process started.";
      if (isRefusal(lastUpstream.status) && !keyed) {
        return (
          `CoinGecko refused with ${lastUpstream.status} and no API key is set. ` +
          "This is the usual cause of blank prices, missing coin logos and empty " +
          "charts on a hosted server: the keyless allowance is per IP and shared " +
          "datacenter IPs are normally already spent. Set COINGECKO_API_KEY."
        );
      }
      if (isRefusal(lastUpstream.status)) {
        return `CoinGecko refused with ${lastUpstream.status} despite a key being set. Check the key is valid and that COINGECKO_PLAN matches it (demo keys are not Pro keys).`;
      }
      return `Last upstream call failed: ${lastUpstream.message}`;
    })(),
  };
}

async function cgGet(path, params) {
  const paused = blockedUntil - Date.now();
  if (paused > 0) {
    // Not an exception in the "something is wrong" sense — it is this module
    // deliberately declining to make things worse. Flagged so logError can say
    // so rather than reporting it as a fresh upstream failure every time.
    const err = new Error(`paused for ${Math.ceil(paused / 1000)}s after a rate limit`);
    err.cgPaused = true;
    throw err;
  }
  const { base, headers } = cgConfig();
  try {
    const { data } = await axios.get(`${base}${path}`, { params, headers, timeout: TIMEOUT });
    backoffMs = 0;
    blockedUntil = 0; // a success means the limit has lifted; recover at once
    noteUpstream(true, null);
    return data;
  } catch (err) {
    noteFailure(err);
    noteUpstream(false, err);
    throw err;
  }
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
    return !e || now - e.ts > marketsTtl();
  });

  if (stale.length > 0) {
    const key = "markets:" + [...stale].sort().join(",");
    await singleFlight(key, async () => {
      try {
        console.log(`CoinGecko GET markets [${stale.join(",")}]`);
        const data = await cgGet("/coins/markets", {
          vs_currency: "usd",
          ids: stale.join(","),
          sparkline: true,
          price_change_percentage: "24h,7d",
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
      if (now - e.ts > marketsTtl()) servedStale++;
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

/**
 * Logo URLs for a set of coin ids.
 *
 * An adapter over the SAME markets cache, exactly like getPrices — NOT a second
 * cache and NOT a second upstream call. Every /coins/markets row already carries
 * an `image` field, so the moment a coin's price is in memory its logo is too,
 * and asking for one costs a Map read. Fetching artwork separately would double
 * our CoinGecko traffic to retrieve a value we were already given, and give us a
 * second thing to invalidate and a second way to get rate limited.
 *
 * `stale` is passed through for the caller's information, but it means far less
 * here than it does for a price. A coin's artwork does not move: an hour old
 * logo URL is still the right logo, whereas an hour old price is a wrong number
 * presented as a right one. So a caller may safely render a stale logo.
 *
 * @returns {Promise<{ logos: Object.<string,string>, stale: boolean, updatedAt: number|null }>}
 */
async function getLogosMap(coinIds) {
  const { markets, stale, updatedAt } = await getMarketsMap(coinIds);
  const logos = {};
  for (const [id, m] of Object.entries(markets)) {
    // Absent rather than present-and-empty. A caller iterating this map should
    // only ever see ids it can actually draw; handing back "" or null would put
    // an empty src on an <img> and render the browser's broken image glyph,
    // which looks worse than the lettered disc it was supposed to replace.
    if (m && typeof m.image === "string" && m.image) logos[id] = m.image;
  }
  return { logos, stale, updatedAt };
}

// ---- chart ----------------------------------------------------------------

/**
 * Historical series for one coin. @returns {{ prices:[[ts,price]], stale, updatedAt }}
 */
async function getChart(coinId, days) {
  const key = `${coinId}:${days}`;
  const now = Date.now();
  const cached = chartCache.get(key);
  const fresh = cached && now - cached.ts <= chartTtl();

  if (!fresh) {
    await singleFlight("chart:" + key, async () => {
      try {
        console.log(`CoinGecko GET chart ${coinId} ${days}d`);
        const data = await cgGet(`/coins/${encodeURIComponent(coinId)}/market_chart`, {
          vs_currency: "usd",
          days,
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
  return { prices: entry.data, stale: now - entry.ts > chartTtl(), updatedAt: entry.ts };
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
  const fresh = cached && now - cached.ts <= searchTtl();

  if (!fresh) {
    await singleFlight("search:" + key, async () => {
      try {
        console.log(`CoinGecko GET search "${key}"`);
        const data = await cgGet("/search", { query: key });
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
  return { coins: entry.data, stale: now - entry.ts > searchTtl() };
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
      const data = await cgGet("/simple/price", { ids: coinId, vs_currencies: "ngn" });
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
  getLogosMap,
  getChart,
  searchCoins,
  getNgnPrice,
  cgStatus,
  MARKETS_TTL,
  CHART_TTL,
  SEARCH_TTL,
};
