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
/**
 * POST /api/alerts/:id/executed  { side, txHash, chainId, qty?, value?, price? }
 *
 * CLOSE A LIVE ALERT THE BROWSER HAS ALREADY ACTED ON.
 *
 * `actOnAlert` is the paper path: it moves cash and holdings in a simulated book
 * and writes a SimTrade. A live trade does none of that — the swap happens on
 * chain, from the user's own wallet, and the server's only record of it is the
 * WalletTx row the browser posts. So there was nothing that ever moved a live
 * alert off `pending`.
 *
 * That mattered far more than it looks. `runPricePass` will not raise a second
 * alert while one is still pending on the same watch (the guard that stopped
 * 1,163 stacked alerts). A live alert that never resolves therefore blocks its
 * watch permanently: Market Watch alerted once per watch and then went silent,
 * for exactly the users who had opted into real money.
 *
 * This records the decision and the transaction, and nothing else. It does not
 * touch Portfolio or SimTrade — the live book is the chain, and inventing rows
 * in a simulated ledger to describe a real trade is what LW-075 was about.
 */
async function executed(req, res) {
  try {
    const alert = await Alert.findOne({ _id: req.params.id, userId: req.user._id });
    if (!alert) return res.status(404).json({ error: "Alert not found" });

    // Same terminal-state guard as `act` and `dismiss` (LW-024). A resolved
    // alert is an audit record and must not be rewritten.
    if (alert.status !== "pending") {
      return res.status(409).json({ error: `Alert is already ${alert.status}` });
    }

    const side = req.body && req.body.side;
    if (side !== "buy" && side !== "sell") {
      return res.status(400).json({ error: 'side must be "buy" or "sell"' });
    }

    const txHash = String((req.body && req.body.txHash) || "").trim();
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

module.exports = { list, history, approve, dismiss, act, executed };
