const { analytics } = require("../services/receivables.service");

// GET /api/receivables/analytics
async function get(req, res) {
  try {
    const data = await analytics(req.user._id);
    return res.json(data);
  } catch (err) {
    console.error("analytics error:", err.message);
    return res.status(500).json({ error: "Failed to compute analytics" });
  }
}

module.exports = { get };
