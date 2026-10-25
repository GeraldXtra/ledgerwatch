const { getPortfolio } = require("../services/market.service");
const { requestedMode } = require("../utils/tradingMode");

async function get(req, res) {
  try {
    const mode = requestedMode(req);
    const portfolio = await getPortfolio(req.user._id, mode);
    return res.json({ portfolio, mode });
  } catch (err) {
    console.error("portfolio error:", err.message);
    return res.status(500).json({ error: "Failed to load portfolio" });
  }
}

module.exports = { get };
