const { getPrices } = require("../services/coingecko.service");

// GET /api/prices?ids=bitcoin,ethereum  (cached/batched; never crashes)
async function get(req, res) {
  try {
    const idsParam = (req.query.ids || "").trim();
    if (!idsParam) {
      return res.status(400).json({ error: "ids query param is required (comma-separated coin ids)" });
    }
    const ids = idsParam
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const prices = await getPrices(ids);
    return res.json({ prices });
  } catch (err) {
    console.error("prices error:", err.message);
    return res.status(500).json({ error: "Failed to fetch prices" });
  }
}

module.exports = { get };
