const { getPortfolio } = require("../services/market.service");

// GET /api/portfolio  (cash, holdings w/ live value, total value, total P/L)
async function get(req, res) {
  try {
    const portfolio = await getPortfolio(req.user._id);
    return res.json({ portfolio });
  } catch (err) {
    console.error("portfolio error:", err.message);
    return res.status(500).json({ error: "Failed to load portfolio" });
  }
}

module.exports = { get };
