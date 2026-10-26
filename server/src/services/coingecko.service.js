const axios = require("axios");

const TIMEOUT = 9000;

const KEYLESS_TTL_FACTOR = 4;

function ttlFactor() {
  return cgConfig().keyed ? 1 : KEYLESS_TTL_FACTOR;
}

const BASE_MARKETS_TTL = 45 * 1000;
const BASE_CHART_TTL = 5 * 60 * 1000;
const BASE_SEARCH_TTL = 10 * 60 * 1000;

const marketsTtl = () => BASE_MARKETS_TTL * ttlFactor();
const chartTtl = () => BASE_CHART_TTL * ttlFactor();
const searchTtl = () => BASE_SEARCH_TTL * ttlFactor();

const MARKETS_TTL = BASE_MARKETS_TTL;
const CHART_TTL = BASE_CHART_TTL;
const SEARCH_TTL = BASE_SEARCH_TTL;

const marketsCache = new Map();
const chartCache = new Map();
const searchCache = new Map();

const MAX_MARKETS_ENTRIES = 2000;
const MARKETS_PAGE = 250;
const MAX_CHART_ENTRIES = 500;
const MAX_SEARCH_ENTRIES = 500;
const MAX_PLATFORMS_ENTRIES = 2000;
const MAX_NGN_ENTRIES = 200;

function cacheSet(cache, key, value, max) {
  cache.delete(key);
  cache.set(key, value);
  if (cache.size <= max) return;
  const excess = cache.size - max;
  let removed = 0;
  for (const k of cache.keys()) {
    cache.delete(k);
    if (++removed >= excess) break;
  }
}

const inFlight = new Map();
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

const lastErrorLogAt = new Map();
const ERROR_LOG_THROTTLE_MS = 60000;

function logError(scope, err) {
  const now = Date.now();
  const prev = lastErrorLogAt.get(scope);
  if (prev && now - prev.at < ERROR_LOG_THROTTLE_MS) {
    prev.suppressed++;
    return;
  }
  if (prev && prev.suppressed) {
    console.error(`CoinGecko ${scope}: ${prev.suppressed} further failure(s) were suppressed`);
  }
  lastErrorLogAt.set(scope, { at: now, suppressed: 0 });

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
  if (isRefusal(status) && !cgConfig().keyed) {
    console.error(
      "CoinGecko refused an unauthenticated request. Hosted IPs are rate limited " +
        "far below a laptop's allowance — set COINGECKO_API_KEY (and " +
        "COINGECKO_PLAN=pro for a Pro key). Prices, coin logos, charts and coin " +
        "search all read this one upstream, so they go dark together."
    );
  }
}

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

const BUDGET_WINDOW_MS = 60 * 1000;
const BUDGETS = {
  none: { total: 8, lookups: 3 },
  demo: { total: 25, lookups: 10 },
  pro: { total: 250, lookups: 100 },
};
const CORE_PATHS = new Set(["/coins/markets", "/simple/price", "/exchange_rates"]);
let recentCalls = [];

function planName() {
  if (!cgConfig().keyed) return "none";
  return String(process.env.COINGECKO_PLAN || "").trim().toLowerCase() === "pro" ? "pro" : "demo";
}

function pruneCalls(now) {
  recentCalls = recentCalls.filter((call) => now - call.at < BUDGET_WINDOW_MS);
}

function budgetUse(now = Date.now()) {
  pruneCalls(now);
  const budget = BUDGETS[planName()];
  const lookupsUsed = recentCalls.filter((call) => call.lookup).length;
  return { ...budget, used: recentCalls.length, lookupsUsed };
}

function reserveCall(path) {
  const now = Date.now();
  const use = budgetUse(now);
  const lookup = !CORE_PATHS.has(path);
  const full = use.used >= use.total || (lookup && use.lookupsUsed >= use.lookups);
  if (!full) {
    recentCalls.push({ at: now, lookup });
    return;
  }
  const blocking = lookup && use.lookupsUsed >= use.lookups ? recentCalls.filter((call) => call.lookup) : recentCalls;
  const waitMs = Math.max(1000, BUDGET_WINDOW_MS - (now - blocking[0].at));
  const err = new Error(
    `the shared allowance for ${lookup ? "coin lookups" : "price calls"} is used up for the next ${Math.ceil(waitMs / 1000)}s`
  );
  err.cgPaused = true;
  err.cgBudget = true;
  throw err;
}

const MIN_BACKOFF_MS = 15 * 1000;
const MAX_BACKOFF_MS = 5 * 60 * 1000;
let blockedUntil = 0;
let backoffMs = 0;

function isRefusal(status) {
  return status === 429 || status === 401 || status === 403 || status === 451;
}

function noteFailure(err) {
  const status = err && err.response && err.response.status;
  if (!isRefusal(status)) return;
  const headers = (err.response && err.response.headers) || {};
  const retryAfter = Number(headers["retry-after"]);
  const wait =
    Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.min(MAX_BACKOFF_MS, retryAfter * 1000)
      : Math.min(MAX_BACKOFF_MS, backoffMs ? backoffMs * 2 : MIN_BACKOFF_MS);
  backoffMs = wait;
  blockedUntil = Date.now() + wait;
}

let lastUpstream = null;

function noteUpstream(ok, err) {
  lastUpstream = {
    at: Date.now(),
    ok,
    status: (err && err.response && err.response.status) || null,
    message: ok ? null : (err && err.message) || "unknown",
  };
}

function cgStatus() {
  const { keyed } = cgConfig();
  const paused = Math.max(0, blockedUntil - Date.now());
  return {
    configured: keyed,
    plan: keyed ? String(process.env.COINGECKO_PLAN || "demo").trim().toLowerCase() : "none",
    pausedForMs: paused,
    budget: { windowSeconds: BUDGET_WINDOW_MS / 1000, ...budgetUse() },
    cachedCoins: marketsCache.size,
    cachedCharts: chartCache.size,
    lastUpstream,
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
    const err = new Error(`paused for ${Math.ceil(paused / 1000)}s after a rate limit`);
    err.cgPaused = true;
    throw err;
  }
  reserveCall(path);
  const { base, headers } = cgConfig();
  try {
    const { data } = await axios.get(`${base}${path}`, { params, headers, timeout: TIMEOUT });
    backoffMs = 0;
    blockedUntil = 0;
    noteUpstream(true, null);
    return data;
  } catch (err) {
    noteFailure(err);
    noteUpstream(false, err);
    throw err;
  }
}

const LOGO_HOSTS = new Set(["coin-images.coingecko.com", "assets.coingecko.com"]);
const LOGO_REWRITE_MS = 6 * 60 * 60 * 1000;
const logoWrittenAt = new Map();
const logoSeenAt = new Map();

function safeLogoUrl(raw) {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || !LOGO_HOSTS.has(u.hostname)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

function coinLogoModel() {
  return require("../models/CoinLogo");
}

async function rememberLogos(rows, { onlyIfMissing = false } = {}) {
  const now = Date.now();
  const ops = [];
  for (const row of rows || []) {
    const coinId = row && row.id;
    const image = safeLogoUrl(row && (row.image || row.large || row.thumb));
    if (!coinId || !image) continue;
    const throttle = onlyIfMissing ? logoSeenAt : logoWrittenAt;
    const last = throttle.get(coinId);
    if (last && now - last < LOGO_REWRITE_MS) continue;
    throttle.set(coinId, now);
    const fields = {
      symbol: row.symbol ? String(row.symbol).toUpperCase().slice(0, 24) : null,
      name: row.name ? String(row.name).slice(0, 80) : null,
      image,
      updatedAt: new Date(now),
    };
    ops.push({
      updateOne: {
        filter: { coinId },
        update: onlyIfMissing ? { $setOnInsert: { coinId, ...fields } } : { $set: fields, $setOnInsert: { coinId } },
        upsert: true,
      },
    });
  }
  if (!ops.length) return 0;
  try {
    await coinLogoModel().bulkWrite(ops, { ordered: false });
    return ops.length;
  } catch (err) {
    const throttle = onlyIfMissing ? logoSeenAt : logoWrittenAt;
    for (const op of ops) throttle.delete(op.updateOne.filter.coinId);
    logError("logos-store", err);
    return 0;
  }
}

async function getStoredLogos(coinIds) {
  const ids = [...new Set((coinIds || []).filter(Boolean))];
  if (!ids.length) return {};
  try {
    const rows = await coinLogoModel().find({ coinId: { $in: ids } }).select("coinId image").lean();
    const out = {};
    for (const r of rows) if (r && r.image) out[r.coinId] = r.image;
    return out;
  } catch (err) {
    logError("logos-read", err);
    return {};
  }
}

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

async function getMarketsMap(coinIds) {
  const ids = [...new Set((coinIds || []).filter(Boolean))];
  if (ids.length === 0) return { markets: {}, stale: false, updatedAt: null };

  const now = Date.now();
  const stale = ids.filter((id) => {
    const e = marketsCache.get(id);
    return !e || now - e.ts > marketsTtl();
  });

  for (let i = 0; i < stale.length; i += MARKETS_PAGE) {
    const chunk = stale.slice(i, i + MARKETS_PAGE);
    const key = "markets:" + [...chunk].sort().join(",");
    await singleFlight(key, async () => {
      try {
        console.log(`CoinGecko GET markets [${chunk.join(",")}]`);
        const data = await cgGet("/coins/markets", {
          vs_currency: "usd",
          ids: chunk.join(","),
          per_page: MARKETS_PAGE,
          page: 1,
          sparkline: true,
          price_change_percentage: "24h,7d",
        });
        const ts = Date.now();
        for (const row of data || []) {
          if (row && row.id) cacheSet(marketsCache, row.id, { data: trimMarket(row), ts }, MAX_MARKETS_ENTRIES);
        }
        rememberLogos(data).catch(() => {});
      } catch (err) {
        logError("markets", err);
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
  const isStale = servedStale > 0 || served < ids.length;
  return { markets, stale: isStale, updatedAt };
}

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

async function logosFor(coinIds, markets) {
  const logos = {};
  for (const [id, m] of Object.entries(markets || {})) {
    const url = safeLogoUrl(m && m.image);
    if (url) logos[id] = url;
  }
  const missing = (coinIds || []).filter((id) => !logos[id]);
  if (missing.length) Object.assign(logos, await getStoredLogos(missing));
  return logos;
}

async function getLogosMap(coinIds) {
  const { markets, stale, updatedAt } = await getMarketsMap(coinIds);
  const logos = await logosFor(coinIds, markets);
  const complete = (coinIds || []).every((id) => logos[id]);
  return { logos, stale: stale && !complete, updatedAt };
}

const TOP_TTL = 30 * 60 * 1000;
const TOP_FALLBACK = [
  ["bitcoin", "BTC", "Bitcoin"],
  ["ethereum", "ETH", "Ethereum"],
  ["tether", "USDT", "Tether"],
  ["binancecoin", "BNB", "BNB"],
  ["solana", "SOL", "Solana"],
  ["ripple", "XRP", "XRP"],
  ["usd-coin", "USDC", "USDC"],
  ["dogecoin", "DOGE", "Dogecoin"],
  ["cardano", "ADA", "Cardano"],
  ["tron", "TRX", "TRON"],
  ["the-open-network", "TON", "Toncoin"],
  ["avalanche-2", "AVAX", "Avalanche"],
  ["chainlink", "LINK", "Chainlink"],
  ["polkadot", "DOT", "Polkadot"],
  ["litecoin", "LTC", "Litecoin"],
  ["shiba-inu", "SHIB", "Shiba Inu"],
  ["bitcoin-cash", "BCH", "Bitcoin Cash"],
  ["uniswap", "UNI", "Uniswap"],
  ["near", "NEAR", "NEAR Protocol"],
  ["stellar", "XLM", "Stellar"],
  ["aptos", "APT", "Aptos"],
  ["sui", "SUI", "Sui"],
  ["pepe", "PEPE", "Pepe"],
  ["arbitrum", "ARB", "Arbitrum"],
  ["optimism", "OP", "Optimism"],
  ["matic-network", "POL", "Polygon"],
  ["cosmos", "ATOM", "Cosmos Hub"],
  ["filecoin", "FIL", "Filecoin"],
  ["internet-computer", "ICP", "Internet Computer"],
  ["aave", "AAVE", "Aave"],
];
let topCache = null;

async function getTopCoins(limit = 30) {
  const n = Math.max(1, Math.min(100, Number(limit) || 30));
  const now = Date.now();
  if (!topCache || now - topCache.ts > TOP_TTL * ttlFactor()) {
    await singleFlight("top", async () => {
      try {
        console.log(`CoinGecko GET top coins (${n})`);
        const data = await cgGet("/coins/markets", {
          vs_currency: "usd",
          order: "market_cap_desc",
          per_page: 100,
          page: 1,
          sparkline: false,
        });
        const ts = Date.now();
        const rows = (data || []).filter((r) => r && r.id);
        for (const row of rows) {
          const cached = marketsCache.get(row.id);
          if (!cached || cached.ts < ts - marketsTtl()) {
            cacheSet(marketsCache, row.id, { data: trimMarket(row), ts }, MAX_MARKETS_ENTRIES);
          }
        }
        rememberLogos(rows).catch(() => {});
        topCache = {
          ts,
          coins: rows.map((r) => ({
            id: r.id,
            symbol: String(r.symbol || "").toUpperCase(),
            name: r.name,
            image: safeLogoUrl(r.image),
            current_price: r.current_price,
          })),
        };
      } catch (err) {
        logError("top", err);
      }
    });
  }

  if (topCache && topCache.coins.length) {
    return { coins: topCache.coins.slice(0, n), stale: now - topCache.ts > TOP_TTL * ttlFactor() };
  }

  const picks = TOP_FALLBACK.slice(0, n);
  const logos = await getStoredLogos(picks.map(([id]) => id));
  const coins = picks.map(([id, symbol, name]) => {
    const m = marketsCache.get(id);
    return {
      id,
      symbol,
      name,
      image: (m && safeLogoUrl(m.data.image)) || logos[id] || null,
      current_price: m ? m.data.current_price : null,
    };
  });
  return { coins, stale: true, fallback: true };
}

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
        cacheSet(
          chartCache,
          key,
          { data: Array.isArray(data && data.prices) ? data.prices : [], ts: Date.now() },
          MAX_CHART_ENTRIES
        );
      } catch (err) {
        logError("chart", err);
      }
    });
  }

  const entry = chartCache.get(key);
  if (!entry) return { prices: [], stale: true, updatedAt: null };
  return { prices: entry.data, stale: now - entry.ts > chartTtl(), updatedAt: entry.ts };
}

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
        const found = (data && Array.isArray(data.coins) ? data.coins : []).slice(0, 15);
        rememberLogos(found, { onlyIfMissing: true }).catch(() => {});
        const coins = found
          .map((c) => ({
            id: c.id,
            symbol: (c.symbol || "").toUpperCase(),
            name: c.name,
            thumb: c.thumb,
          }));
        cacheSet(searchCache, key, { data: coins, ts: Date.now() }, MAX_SEARCH_ENTRIES);
      } catch (err) {
        logError("search", err);
      }
    });
  }

  const entry = searchCache.get(key);
  if (!entry) return { coins: [], stale: true };
  return { coins: entry.data, stale: now - entry.ts > searchTtl() };
}

const PLATFORMS_TTL = 24 * 60 * 60 * 1000;
const COIN_PLATFORMS_TTL = 6 * 60 * 60 * 1000;
const COIN_NOT_FOUND_TTL = 10 * 60 * 1000;

let platformsCache = null;
const coinPlatformsCache = new Map();

async function getAssetPlatforms() {
  const now = Date.now();
  const fresh = platformsCache && now - platformsCache.ts <= PLATFORMS_TTL;

  if (!fresh) {
    await singleFlight("asset_platforms", async () => {
      try {
        console.log("CoinGecko GET asset_platforms");
        const data = await cgGet("/asset_platforms");
        const platforms = {};
        const byChainId = {};
        for (const row of Array.isArray(data) ? data : []) {
          if (!row || !row.id) continue;
          const chainId = Number.isInteger(row.chain_identifier) ? row.chain_identifier : null;
          platforms[row.id] = {
            id: row.id,
            chainId,
            name: row.name || row.id,
            nativeCoinId: row.native_coin_id || null,
          };
          if (chainId != null && byChainId[chainId] === undefined) byChainId[chainId] = row.id;
        }
        if (Object.keys(platforms).length > 0) {
          platformsCache = { data: { platforms, byChainId }, ts: Date.now() };
        }
      } catch (err) {
        logError("asset_platforms", err);
      }
    });
  }

  if (!platformsCache) return { platforms: {}, byChainId: {}, stale: true, available: false };
  return {
    ...platformsCache.data,
    stale: Date.now() - platformsCache.ts > PLATFORMS_TTL,
    available: true,
  };
}

async function getCoinPlatforms(coinId) {
  const id = String(coinId || "").trim().toLowerCase();
  if (!id) return null;
  const now = Date.now();
  const cached = coinPlatformsCache.get(id);
  const ttl = cached && cached.data && cached.data.notFound ? COIN_NOT_FOUND_TTL : COIN_PLATFORMS_TTL;
  const fresh = cached && now - cached.ts <= ttl;

  if (!fresh) {
    await singleFlight("coin_platforms:" + id, async () => {
      try {
        console.log(`CoinGecko GET coin platforms "${id}"`);
        const data = await cgGet(`/coins/${encodeURIComponent(id)}`, {
          localization: false,
          tickers: false,
          market_data: false,
          community_data: false,
          developer_data: false,
          sparkline: false,
        });
        const platforms = {};
        const detail = (data && data.detail_platforms) || {};
        for (const [platformId, info] of Object.entries(detail)) {
          const address =
            info && typeof info.contract_address === "string" ? info.contract_address.trim() : "";
          if (!address) continue;
          const decimals =
            Number.isInteger(info.decimal_place) && info.decimal_place >= 0 && info.decimal_place <= 36
              ? info.decimal_place
              : null;
          platforms[platformId] = { address, decimals };
        }
        cacheSet(
          coinPlatformsCache,
          id,
          {
            data: {
              coinId: id,
              symbol: data && data.symbol ? String(data.symbol).toUpperCase() : null,
              name: (data && data.name) || null,
              platforms,
            },
            ts: Date.now(),
          },
          MAX_PLATFORMS_ENTRIES
        );
      } catch (err) {
        if (err && err.response && err.response.status === 404) {
          cacheSet(coinPlatformsCache, id, { data: { notFound: true }, ts: Date.now() }, MAX_PLATFORMS_ENTRIES);
          return;
        }
        logError("coin platforms", err);
      }
    });
  }

  const entry = coinPlatformsCache.get(id);
  if (!entry) return null;
  if (entry.data.notFound) return { notFound: true };
  return { ...entry.data, stale: Date.now() - entry.ts > COIN_PLATFORMS_TTL };
}

const ngnCache = new Map();
const NGN_TTL = 5 * 60 * 1000;

async function getNgnPrice(coinId = "usd-coin") {
  const now = Date.now();
  const hit = ngnCache.get(coinId);
  if (hit && now - hit.ts < NGN_TTL) return { ngn: hit.ngn, stale: false, fetchedAt: hit.ts };

  await singleFlight(`ngn:${coinId}`, async () => {
    try {
      console.log(`CoinGecko GET simple/price [${coinId} in ngn]`);
      const data = await cgGet("/simple/price", { ids: coinId, vs_currencies: "ngn" });
      const ngn = data && data[coinId] && data[coinId].ngn;
      if (typeof ngn === "number" && ngn > 0) {
        cacheSet(ngnCache, coinId, { ngn, ts: Date.now() }, MAX_NGN_ENTRIES);
      }
    } catch (err) {
      logError("simple/price ngn", err);
    }
  });

  const entry = ngnCache.get(coinId);
  if (!entry) return null;
  return {
    ngn: entry.ngn,
    stale: Date.now() - entry.ts > NGN_TTL,
    fetchedAt: entry.ts,
  };
}

const BASE_FIAT_TTL = 10 * 60 * 1000;
const fiatTtl = () => BASE_FIAT_TTL * ttlFactor();
let fiatCache = null;

function fiatRatesFrom(data) {
  const rates = data && data.rates;
  const usd = rates && rates.usd && Number(rates.usd.value);
  if (!rates || !Number.isFinite(usd) || usd <= 0) return null;
  const out = {};
  for (const [code, row] of Object.entries(rates)) {
    if (!row || row.type !== "fiat") continue;
    const value = Number(row.value);
    if (!Number.isFinite(value) || value <= 0) continue;
    out[code.toUpperCase()] = value / usd;
  }
  out.USD = 1;
  return out;
}

async function getFiatRates() {
  const now = Date.now();
  if (!fiatCache || now - fiatCache.ts > fiatTtl()) {
    await singleFlight("fiat-rates", async () => {
      try {
        console.log("CoinGecko GET exchange_rates");
        const data = await cgGet("/exchange_rates");
        const rates = fiatRatesFrom(data);
        if (rates) fiatCache = { rates, ts: Date.now() };
      } catch (err) {
        logError("exchange_rates", err);
      }
    });
  }
  if (!fiatCache) return { rates: { USD: 1 }, stale: true, updatedAt: null, available: false };
  return {
    rates: { ...fiatCache.rates },
    stale: Date.now() - fiatCache.ts > fiatTtl(),
    updatedAt: fiatCache.ts,
    available: true,
  };
}

function _resetForTests() {
  fiatCache = null;
  marketsCache.clear();
  chartCache.clear();
  searchCache.clear();
  coinPlatformsCache.clear();
  ngnCache.clear();
  logoWrittenAt.clear();
  logoSeenAt.clear();
  topCache = null;
  platformsCache = null;
  blockedUntil = 0;
  backoffMs = 0;
  recentCalls = [];
  lastUpstream = null;
}

module.exports = {
  _resetForTests,
  getMarketsMap,
  getPrices,
  getPrice,
  getLogosMap,
  logosFor,
  getStoredLogos,
  rememberLogos,
  getTopCoins,
  safeLogoUrl,
  getChart,
  searchCoins,
  getAssetPlatforms,
  getCoinPlatforms,
  getNgnPrice,
  getFiatRates,
  cgStatus,
  MARKETS_TTL,
  CHART_TTL,
  SEARCH_TTL,
};
