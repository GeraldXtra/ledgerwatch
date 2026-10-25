const { scopedRepo } = require("../repositories/scoped");
const { requestedMode } = require("../utils/tradingMode");
const { getMarketsMap, logosFor } = require("../services/coingecko.service");

const MAX_IDS = 250;

async function get(req, res) {
  try {
    let ids = String(req.query.ids || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => /^[a-z0-9-]{1,64}$/.test(s))
      .slice(0, MAX_IDS);

    if (ids.length === 0) {
      const watches = await scopedRepo(req.user._id).watches.find({ active: true, mode: requestedMode(req) });
      ids = [...new Set(watches.map((w) => w.coinId))].slice(0, MAX_IDS);
    }

    const { markets, stale, updatedAt } = await getMarketsMap(ids);
    const list = ids.map((id) => markets[id]).filter(Boolean);
    const logos = await logosFor(ids, markets);
    return res.json({ markets: list, logos, stale, updatedAt });
  } catch (err) {
    console.error("markets error:", err.message);
    return res.status(500).json({ error: "Failed to fetch markets" });
  }
}

module.exports = { get, MAX_IDS };
