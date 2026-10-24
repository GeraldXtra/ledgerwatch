const mongoose = require("mongoose");
const { listProfits, dismissProfit } = require("../services/profit.service");

async function list(req, res) {
  try {
    const mode = ["paper", "live"].includes(req.query.mode) ? req.query.mode : null;
    return res.json(await listProfits(req.user._id, mode));
  } catch (err) {
    console.error("profits list error:", err.message);
    return res.status(500).json({ error: "Failed to load profits" });
  }
}

async function dismiss(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: "Invalid profit record" });
    const row = await dismissProfit(req.user._id, req.params.id);
    if (!row) return res.status(409).json({ error: "That profit is not waiting to be moved." });
    return res.json({ profit: row });
  } catch (err) {
    console.error("profits dismiss error:", err.message);
    return res.status(500).json({ error: "Failed to update that profit" });
  }
}

module.exports = { list, dismiss };
