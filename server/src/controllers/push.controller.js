const PushSubscription = require("../models/PushSubscription");
const User = require("../models/User");
const Debt = require("../models/Debt");
const Alert = require("../models/Alert");
const { publicKey, verifyActionToken } = require("../services/push.service");
const {
  generateReminderForDebt,
  dispatchReminder,
} = require("../services/reminder.service");
const { approveAlert } = require("../services/market.service");

// GET /api/push/key  -> the VAPID public key (or null when push is not configured).
async function key(req, res) {
  return res.json({ publicKey: publicKey() });
}

// POST /api/push/subscribe  { subscription: { endpoint, keys:{p256dh, auth} } }
// Upsert by endpoint so re-subscribing the same browser never duplicates.
async function subscribe(req, res) {
  try {
    const sub = req.body && req.body.subscription;
    if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
      return res.status(400).json({ error: "Invalid subscription" });
    }
    await PushSubscription.findOneAndUpdate(
      { endpoint: sub.endpoint },
      {
        userId: req.user._id,
        endpoint: sub.endpoint,
        keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
        userAgent: req.headers["user-agent"],
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    return res.status(201).json({ ok: true });
  } catch (err) {
    console.error("push subscribe error:", err.message);
    return res.status(500).json({ error: "Failed to subscribe" });
  }
}

// POST /api/push/unsubscribe  { endpoint }
async function unsubscribe(req, res) {
  try {
    const endpoint = req.body && req.body.endpoint;
    if (!endpoint) return res.status(400).json({ error: "endpoint required" });
    // Only remove the caller's own subscription.
    await PushSubscription.deleteOne({ endpoint, userId: req.user._id });
    return res.json({ ok: true });
  } catch (err) {
    console.error("push unsubscribe error:", err.message);
    return res.status(500).json({ error: "Failed to unsubscribe" });
  }
}

// POST /api/push/action  { token, action }
// Authenticated by the short-lived action token in the payload (NOT the Bearer JWT —
// a service worker cannot read localStorage). The token is bound to one action and
// one resource; we re-check ownership and the requested action against it.
async function action(req, res) {
  try {
    const { token } = req.body || {};
    if (!token) return res.status(400).json({ error: "token required" });

    let claims;
    try {
      claims = verifyActionToken(token);
    } catch {
      return res.status(401).json({ error: "Invalid or expired action token" });
    }

    const user = await User.findById(claims.sub).select("-passwordHash");
    if (!user) return res.status(401).json({ error: "User no longer exists" });

    if (claims.act === "send_whatsapp" || claims.act === "send_email") {
      const debt = await Debt.findOne({ _id: claims.ref, userId: user._id });
      if (!debt) return res.status(404).json({ error: "Debt not found" });
      const channel = claims.act === "send_whatsapp" ? "whatsapp" : "email";
      const result = await generateReminderForDebt(debt, user);
      const deliveries = await dispatchReminder(result.reminder, debt, user, {
        channels: [channel],
      });
      return res.json({ ok: true, act: claims.act, deliveries });
    }

    if (claims.act === "approve") {
      const alert = await Alert.findOne({ _id: claims.ref, userId: user._id });
      if (!alert) return res.status(404).json({ error: "Alert not found" });
      if (alert.status !== "pending") {
        return res.json({ ok: true, act: "approve", already: alert.status });
      }
      const result = await approveAlert(user._id, alert);
      return res.json({ ok: true, act: "approve", ...result });
    }

    if (claims.act === "dismiss") {
      // Dismiss a pending alert if the ref is an alert; harmless no-op otherwise.
      await Alert.updateOne(
        { _id: claims.ref, userId: user._id, status: "pending" },
        { status: "dismissed" }
      ).catch(() => {});
      return res.json({ ok: true, act: "dismiss" });
    }

    return res.status(400).json({ error: "Unknown action" });
  } catch (err) {
    console.error("push action error:", err.message);
    return res.status(500).json({ error: "Action failed" });
  }
}

module.exports = { key, subscribe, unsubscribe, action };
