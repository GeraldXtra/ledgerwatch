const { getChart, searchCoins, getTopCoins } = require("../services/coingecko.service");

const ALLOWED_DAYS = new Set(["1", "7", "30", "90"]);
const COIN_ID_RE = /^[a-z0-9-]{1,64}$/;
const MAX_QUERY_CHARS = 64;

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

async function top(req, res) {
  try {
    const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 30));
    const { coins, stale, fallback } = await getTopCoins(limit);
    return res.json({ coins, stale: Boolean(stale), fallback: Boolean(fallback) });
  } catch (err) {
    console.error("top coins error:", err.message);
    return res.status(500).json({ error: "Failed to load popular coins" });
  }
}

module.exports = { search, chart, top };
