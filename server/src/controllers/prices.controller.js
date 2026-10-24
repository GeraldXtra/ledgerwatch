const { getPrices } = require("../services/coingecko.service");

async function get(req, res) {
  try {
    const idsParam = String(req.query.ids || "").trim();
    if (!idsParam) {
      return res.status(400).json({ error: "ids query param is required (comma-separated coin ids)" });
    }
    const ids = idsParam
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => /^[a-z0-9-]{1,64}$/.test(s))
      .slice(0, 250);

    const prices = await getPrices(ids);
    return res.json({ prices });
  } catch (err) {
    console.error("prices error:", err.message);
    return res.status(500).json({ error: "Failed to fetch prices" });
  }
}

module.exports = { get };
