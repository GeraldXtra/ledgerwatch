const { scopedRepo } = require("../repositories/scoped");
const { approveAlert, actOnAlert } = require("../services/market.service");
const { requestedMode } = require("../utils/tradingMode");

async function list(req, res) {
  try {
    const mode = requestedMode(req);
    const alerts = await scopedRepo(req.user._id).alerts.find({ mode, status: "pending" }).sort({ createdAt: -1 });
    return res.json({ alerts, mode });
  } catch (err) {
    console.error("list alerts error:", err.message);
    return res.status(500).json({ error: "Failed to list alerts" });
  }
}

async function history(req, res) {
  try {
    const mode = requestedMode(req);
    const alerts = await scopedRepo(req.user._id).alerts.find({ mode, status: { $in: ["approved", "dismissed"] } })
      .sort({ createdAt: -1 })
      .limit(50);
    return res.json({ alerts, mode });
  } catch (err) {
    console.error("alert history error:", err.message);
    return res.status(500).json({ error: "Failed to list alert history" });
  }
}

async function approve(req, res) {
  try {
    const alert = await scopedRepo(req.user._id).alerts.findById(req.params.id);
    if (!alert) return res.status(404).json({ error: "Alert not found" });

    const result = await approveAlert(req.user._id, alert);
    return res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error("approve alert error:", err.message);
    return res.status(500).json({ error: "Failed to approve alert" });
  }
}

async function executed(req, res) {
  try {
    const alert = await scopedRepo(req.user._id).alerts.findById(req.params.id);
    if (!alert) return res.status(404).json({ error: "Alert not found" });

    if (alert.status !== "pending") {
      return res.status(409).json({ error: `Alert is already ${alert.status}` });
    }

    const side = req.body.side;
    if (side !== "buy" && side !== "sell") {
      return res.status(400).json({ error: 'side must be "buy" or "sell"' });
    }

    const txHash = String(req.body.txHash || "").trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
      return res.status(400).json({ error: "A transaction hash is required to close a live alert" });
    }

    const num = (v) => {
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 ? n : null;
    };

    alert.status = "approved";
    alert.userAction = side;
    alert.executedQty = num(req.body.qty);
    alert.executedValue = num(req.body.value);
    alert.executedPrice = num(req.body.price);
    alert.txHash = txHash;
    alert.chainId = Number.isFinite(Number(req.body.chainId)) ? Number(req.body.chainId) : null;
    alert.actedAt = new Date();
    await alert.save();

    return res.json({ alert });
  } catch (err) {
    console.error("executed alert error:", err.message);
    return res.status(500).json({ error: "Failed to record the trade against this alert" });
  }
}

async function dismiss(req, res) {
  try {
    const alert = await scopedRepo(req.user._id).alerts.findById(req.params.id);
    if (!alert) return res.status(404).json({ error: "Alert not found" });

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

async function act(req, res) {
  try {
    const { action, amount, denom } = req.body;
    const alert = await scopedRepo(req.user._id).alerts.findById(req.params.id);
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
    return res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error("act on alert error:", err.message);
    return res.status(500).json({ error: "Failed to act on alert" });
  }
}

module.exports = { list, history, approve, dismiss, act, executed };
