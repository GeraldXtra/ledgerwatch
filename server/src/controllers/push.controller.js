const PushSubscription = require("../models/PushSubscription");
const User = require("../models/User");
const Alert = require("../models/Alert");
const Debt = require("../models/Debt");
const {
  publicKey,
  verifyActionToken,
  notifyUser,
  pushConfigured,
} = require("../services/push.service");
const {
  generateReminderForDebt,
  dispatchReminder,
} = require("../services/reminder.service");

// GET /api/push/key -> VAPID public key (null when push is not configured).
async function key(req, res) {
  return res.json({ publicKey: publicKey(), configured: pushConfigured() });
}

// POST /api/push/subscribe { subscription }
async function subscribe(req, res) {
  try {
    const sub = req.body && req.body.subscription;
    if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
      return res.status(400).json({ error: "Invalid subscription" });
    }
    // Upsert by endpoint so re-subscribing the same browser never duplicates.
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

// POST /api/push/unsubscribe { endpoint }
async function unsubscribe(req, res) {
  try {
    const endpoint = req.body && req.body.endpoint;
    if (!endpoint) return res.status(400).json({ error: "endpoint required" });
    await PushSubscription.deleteOne({ endpoint, userId: req.user._id });
    return res.json({ ok: true });
  } catch (err) {
    console.error("push unsubscribe error:", err.message);
    return res.status(500).json({ error: "Failed to unsubscribe" });
  }
}

// POST /api/push/test -> lets the user verify delivery end to end.
async function test(req, res) {
  try {
    const result = await notifyUser(req.user._id, {
      title: "LedgerWatch test notification",
      body: "If you can see this, notifications are working on this device.",
      tag: "test",
      type: "test",
      url: "/app/settings",
    });
    if (result.skipped) {
      return res
        .status(503)
        .json({ error: "Push is not configured on the server (no VAPID keys)." });
    }
    if (result.sent === 0) {
      return res
        .status(404)
        .json({ error: "No push subscriptions for this account. Enable notifications first." });
    }
    return res.json({ ok: true, sent: result.sent });
  } catch (err) {
    console.error("push test error:", err.message);
    return res.status(500).json({ error: "Failed to send test notification" });
  }
}

/**
 * POST /api/push/action { token, action }
 *
 * Authenticated by the short-lived action token in the body, because a service
 * worker cannot attach the Bearer JWT. The token is bound to one action and one
 * resource, and is re-checked against the requested action here.
 *
 * NOTE: buy/sell are deliberately NOT executable from a notification — those
 * deep-link into the app so the user still sets an amount and confirms.
 */
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

    if (claims.act === "dismiss_alert") {
      await Alert.updateOne(
        { _id: claims.ref, userId: user._id, status: "pending" },
        { status: "dismissed", userAction: "dismiss", actedAt: new Date() }
      );
      return res.json({ ok: true, act: claims.act });
    }

    if (claims.act === "send_whatsapp" || claims.act === "send_email") {
      const debt = await Debt.findOne({ _id: claims.ref, userId: user._id });
      if (!debt) return res.status(404).json({ error: "Debt not found" });
      const channel = claims.act === "send_whatsapp" ? "whatsapp" : "email";
      const generated = await generateReminderForDebt(debt, user);
      // force: the user tapped this button on the notification, so it is an
      // explicit instruction to send, not an automation pass to be rate limited.
      const deliveries = await dispatchReminder(generated.reminder, debt, user, {
        channels: [channel],
        force: true,
      });
      return res.json({ ok: true, act: claims.act, deliveries });
    }

    return res.status(400).json({ error: "Unknown action" });
  } catch (err) {
    console.error("push action error:", err.message);
    return res.status(500).json({ error: "Action failed" });
  }
}

module.exports = { key, subscribe, unsubscribe, test, action };
