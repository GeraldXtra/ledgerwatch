const Watch = require("../models/Watch");
const { getMarketsMap } = require("../services/coingecko.service");

const MAX_IDS = 50;

async function get(req, res) {
  try {
    let ids = String(req.query.ids || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => /^[a-z0-9-]{1,64}$/.test(s))
      .slice(0, MAX_IDS);

    if (ids.length === 0) {
      const watches = await Watch.find({ userId: req.user._id, active: true, mode: req.user.tradingMode === "live" ? "live" : "paper" });
      ids = [...new Set(watches.map((w) => w.coinId))];
    }

    const { markets, stale, updatedAt } = await getMarketsMap(ids);
    const list = ids.map((id) => markets[id]).filter(Boolean);
    return res.json({ markets: list, stale, updatedAt });
  } catch (err) {
    console.error("markets error:", err.message);
    return res.status(500).json({ error: "Failed to fetch markets" });
  }
}

module.exports = { get };
