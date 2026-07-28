const Alert = require("../models/Alert");
const { approveAlert } = require("../services/market.service");

// GET /api/alerts  (my pending alerts, newest first)
async function list(req, res) {
  try {
    const alerts = await Alert.find({
      userId: req.user._id,
      status: "pending",
    }).sort({ createdAt: -1 });
    return res.json({ alerts });
  } catch (err) {
    console.error("list alerts error:", err.message);
    return res.status(500).json({ error: "Failed to list alerts" });
  }
}

// GET /api/alerts/history  (approved + dismissed, newest first)
async function history(req, res) {
  try {
    const alerts = await Alert.find({
      userId: req.user._id,
      status: { $in: ["approved", "dismissed"] },
    })
      .sort({ createdAt: -1 })
      .limit(50);
    return res.json({ alerts });
  } catch (err) {
    console.error("alert history error:", err.message);
    return res.status(500).json({ error: "Failed to list alert history" });
  }
}

// PATCH /api/alerts/:id/approve  -> SimTrade + Portfolio update (section 2a)
async function approve(req, res) {
  try {
    const alert = await Alert.findOne({ _id: req.params.id, userId: req.user._id });
    if (!alert) return res.status(404).json({ error: "Alert not found" });

    const result = await approveAlert(req.user._id, alert);
    return res.json(result); // { alert, trade, portfolio }
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error("approve alert error:", err.message);
    return res.status(500).json({ error: "Failed to approve alert" });
  }
}

// PATCH /api/alerts/:id/dismiss
async function dismiss(req, res) {
  try {
    const alert = await Alert.findOne({ _id: req.params.id, userId: req.user._id });
    if (!alert) return res.status(404).json({ error: "Alert not found" });

    alert.status = "dismissed";
    await alert.save();
    return res.json({ alert });
  } catch (err) {
    console.error("dismiss alert error:", err.message);
    return res.status(500).json({ error: "Failed to dismiss alert" });
  }
}

module.exports = { list, history, approve, dismiss };
