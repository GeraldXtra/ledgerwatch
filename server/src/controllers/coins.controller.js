const { getChart, searchCoins } = require("../services/coingecko.service");

const ALLOWED_DAYS = new Set(["1", "7", "30", "90"]);
// CoinGecko ids are lowercase letters, digits and hyphens. Anything else is not
// a coin id and must not reach the upstream URL or the chart cache key.
const COIN_ID_RE = /^[a-z0-9-]{1,64}$/;
// A search term is a word or two. It becomes an upstream query and a cache key,
// so it is bounded; a non-string value used to reach `.trim()` and answer 500.
const MAX_QUERY_CHARS = 64;

// GET /api/coins/search?q=sol  (cached 10 min; never crashes)
async function search(req, res) {
  try {
    const q = String(req.query.q || "").trim().slice(0, MAX_QUERY_CHARS);
    if (q.length < 2) return res.json({ coins: [] });
    const { coins, stale } = await searchCoins(q);
    return res.json({ coins, stale });
  } catch (err) {
    console.error("coin search error:", err.message);
    return res.status(500).json({ error: "Failed to search coins" });
  }
}

// GET /api/coins/:id/chart?days=1|7|30|90  (cached 5 min; never crashes)
async function chart(req, res) {
  try {
    const days = String(req.query.days || "7");
    if (!ALLOWED_DAYS.has(days)) {
      return res.status(400).json({ error: "days must be one of 1, 7, 30, 90" });
    }
    const id = String(req.params.id || "").toLowerCase();
    if (!COIN_ID_RE.test(id)) {
      return res.status(400).json({ error: "That is not a valid coin id" });
    }
    const { prices, stale, updatedAt } = await getChart(id, days);
    return res.json({ prices, days: Number(days), stale, updatedAt });
  } catch (err) {
    console.error("coin chart error:", err.message);
    return res.status(500).json({ error: "Failed to fetch chart" });
  }
}

module.exports = { search, chart };
