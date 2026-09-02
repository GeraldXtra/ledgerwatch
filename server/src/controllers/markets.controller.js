const Watch = require("../models/Watch");
const { getMarketsMap } = require("../services/coingecko.service");

// GET /api/markets?ids=bitcoin,ethereum  (cached/single-flight; never crashes)
// If ids is omitted, defaults to the caller's active-watch coin ids.
async function get(req, res) {
  try {
    let ids = (req.query.ids || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (ids.length === 0) {
      const watches = await Watch.find({ userId: req.user._id, active: true, mode: req.user.tradingMode === "live" ? "live" : "paper" });
      ids = [...new Set(watches.map((w) => w.coinId))];
    }

    const { markets, stale, updatedAt } = await getMarketsMap(ids);
    // Return as an array in the order of the requested ids (missing ones dropped).
    const list = ids.map((id) => markets[id]).filter(Boolean);
    return res.json({ markets: list, stale, updatedAt });
  } catch (err) {
    console.error("markets error:", err.message);
    return res.status(500).json({ error: "Failed to fetch markets" });
  }
}

module.exports = { get };
