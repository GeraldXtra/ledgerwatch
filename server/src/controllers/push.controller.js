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

async function key(req, res) {
  return res.json({ publicKey: publicKey(), configured: pushConfigured() });
}

function subscriptionProblem(sub) {
  if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
    return "Invalid subscription";
  }
  if (
    typeof sub.endpoint !== "string" ||
    sub.endpoint.length > 2048 ||
    typeof sub.keys.p256dh !== "string" ||
    sub.keys.p256dh.length > 256 ||
    typeof sub.keys.auth !== "string" ||
    sub.keys.auth.length > 128
  ) {
    return "Invalid subscription";
  }

  let host;
  try {
    const u = new URL(String(sub.endpoint));
    if (u.protocol !== "https:") throw new Error("not https");
    host = u.hostname.toLowerCase();
  } catch {
    return "Invalid subscription endpoint";
  }
  const allowedHost =
    host === "fcm.googleapis.com" ||
    host === "updates.push.services.mozilla.com" ||
    host.endsWith(".notify.windows.com") ||
    host.endsWith(".push.apple.com");
  return allowedHost ? null : "That push service is not supported";
}

async function bindDevice(userId, sub, userAgent) {
  await PushSubscription.deleteMany({ endpoint: sub.endpoint, userId: { $ne: userId } });
  const row = { userId, endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } };
  if (userAgent) row.userAgent = String(userAgent).slice(0, 400);
  try {
    return await PushSubscription.findOneAndUpdate({ endpoint: sub.endpoint, userId }, row, {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    });
  } catch (err) {
    if (err.code !== 11000) throw err;
    await PushSubscription.deleteMany({ endpoint: sub.endpoint, userId: { $ne: userId } });
    return PushSubscription.findOneAndUpdate({ endpoint: sub.endpoint, userId }, row, {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    });
  }
}

async function subscribe(req, res) {
  try {
    const sub = req.body && req.body.subscription;
    const problem = subscriptionProblem(sub);
    if (problem) return res.status(400).json({ error: problem });
    const replaces = req.body && typeof req.body.replaces === "string" ? req.body.replaces : null;
    if (replaces && replaces !== sub.endpoint) {
      await PushSubscription.deleteOne({ endpoint: replaces, userId: req.user._id });
    }
    await bindDevice(req.user._id, sub, req.headers["user-agent"]);
    const devices = await PushSubscription.countDocuments({ userId: req.user._id });
    return res.status(201).json({ ok: true, devices });
  } catch (err) {
    console.error("push subscribe error:", err.message);
    return res.status(500).json({ error: "Failed to subscribe" });
  }
}

async function resubscribe(req, res) {
  try {
    const oldEndpoint = req.body && req.body.oldEndpoint;
    const sub = req.body && req.body.subscription;
    if (typeof oldEndpoint !== "string" || !oldEndpoint || oldEndpoint.length > 2048) {
      return res.status(400).json({ error: "oldEndpoint required" });
    }
    const problem = subscriptionProblem(sub);
    if (problem) return res.status(400).json({ error: problem });

    const previous = await PushSubscription.find({ endpoint: oldEndpoint }).select("userId").lean();
    if (!previous.length) return res.status(404).json({ error: "That subscription is not known" });
    const owner = previous[0].userId;
    await PushSubscription.deleteMany({ endpoint: oldEndpoint });
    await bindDevice(owner, sub, req.headers["user-agent"]);
    return res.json({ ok: true });
  } catch (err) {
    console.error("push resubscribe error:", err.message);
    return res.status(500).json({ error: "Failed to resubscribe" });
  }
}

async function devices(req, res) {
  try {
    const rows = await PushSubscription.find({ userId: req.user._id })
      .select("endpoint userAgent createdAt")
      .sort({ createdAt: -1 })
      .lean();
    return res.json({
      devices: rows.map((r) => ({
        endpoint: r.endpoint,
        userAgent: r.userAgent || null,
        createdAt: r.createdAt,
      })),
    });
  } catch (err) {
    console.error("push devices error:", err.message);
    return res.status(500).json({ error: "Failed to list devices" });
  }
}

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

const spentTokens = new Map();
const TOKEN_TTL_MS = 15 * 60 * 1000;

function spendToken(token) {
  const now = Date.now();
  for (const [sig, expiry] of spentTokens) {
    if (expiry <= now) spentTokens.delete(sig);
  }
  const signature = String(token).split(".")[2] || String(token);
  if (spentTokens.has(signature)) return false;
  spentTokens.set(signature, now + TOKEN_TTL_MS);
  return true;
}

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

    const requested = req.body && req.body.action;
    if (requested && String(requested) !== claims.act) {
      return res.status(400).json({ error: "That button does not match its token" });
    }

    if (!spendToken(token)) {
      return res.status(409).json({ error: "That notification action has already been used." });
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
      const deliveries = await dispatchReminder(generated.reminder, debt, user, {
        channels: [channel],
        force: true,
      });
      return res.json({ ok: true, act: claims.act, deliveries });
    }

    return res.status(400).json({ error: "Unknown action" });
  } catch (err) {
    if (err && err.status) return res.status(err.status).json({ error: err.message });
    console.error("push action error:", err.message);
    return res.status(500).json({ error: "Action failed" });
  }
}

module.exports = { key, subscribe, resubscribe, devices, unsubscribe, test, action, bindDevice };
