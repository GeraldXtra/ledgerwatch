const Alert = require("../models/Alert");
const { approveAlert, actOnAlert } = require("../services/market.service");

// GET /api/alerts  (my pending alerts, newest first)
async function list(req, res) {
  try {
    const mode = req.user.tradingMode === "live" ? "live" : "paper";
    const alerts = await Alert.find({
      mode,
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
    const mode = req.user.tradingMode === "live" ? "live" : "paper";
    const alerts = await Alert.find({
      mode,
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

    // The same guard `act` has (LW-024). This legacy route still overwrote an
    // approved alert's `userAction` with "dismiss" while `executedQty` stayed
    // filled in: a trade that happened, recorded as declined.
    if (alert.status !== "pending") {
      return res.status(409).json({ error: `Alert is already ${alert.status}` });
    }

    alert.status = "dismissed";
    alert.userAction = "dismiss";
    alert.actedAt = new Date();
    await alert.save();
    return res.json({ alert });
  } catch (err) {
    console.error("dismiss alert error:", err.message);
    return res.status(500).json({ error: "Failed to dismiss alert" });
  }
}

/**
 * POST /api/alerts/:id/act   { action: "buy"|"sell"|"dismiss", amount, denom }
 *
 * The user picks BOTH the side and the amount. The agent's suggestion is only a
 * recommendation, so acting against it is allowed and is recorded as such.
 */
async function act(req, res) {
  try {
    const { action, amount, denom } = req.body || {};
    const alert = await Alert.findOne({ _id: req.params.id, userId: req.user._id });
    if (!alert) return res.status(404).json({ error: "Alert not found" });

    if (action === "dismiss") {
      if (alert.status !== "pending") {
        return res.status(409).json({ error: `Alert is already ${alert.status}` });
      }
      alert.status = "dismissed";
      alert.userAction = "dismiss";
      alert.actedAt = new Date();
      await alert.save();
      return res.json({ alert });
    }

    if (action !== "buy" && action !== "sell") {
      return res.status(400).json({ error: 'action must be "buy", "sell" or "dismiss"' });
    }

    const result = await actOnAlert(req.user._id, alert, { action, amount, denom });
    return res.json(result); // { alert, trade, portfolio }
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error("act on alert error:", err.message);
    return res.status(500).json({ error: "Failed to act on alert" });
  }
}

module.exports = { list, history, approve, dismiss, act };
