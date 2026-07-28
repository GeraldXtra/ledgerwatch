const { getChart, searchCoins } = require("../services/coingecko.service");

const ALLOWED_DAYS = new Set(["1", "7", "30", "90"]);

// GET /api/coins/search?q=sol  (cached 10 min; never crashes)
async function search(req, res) {
  try {
    const q = (req.query.q || "").trim();
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
    const { prices, stale, updatedAt } = await getChart(req.params.id, days);
    return res.json({ prices, days: Number(days), stale, updatedAt });
  } catch (err) {
    console.error("coin chart error:", err.message);
    return res.status(500).json({ error: "Failed to fetch chart" });
  }
}

module.exports = { search, chart };
