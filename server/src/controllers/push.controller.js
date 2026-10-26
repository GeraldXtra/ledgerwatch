const crypto = require("crypto");
const { scopedRepo } = require("../repositories/scoped");
const accounts = require("../repositories/accounts");
const devicesRepo = require("../repositories/devices");
const { pushStatus, verifyActionToken, notifyUser } = require("../services/push.service");
const {
  generateReminderForDebt,
  dispatchReminder,
} = require("../services/reminder.service");

async function key(req, res) {
  const status = pushStatus();
  return res.json({ publicKey: status.publicKey, configured: status.configured, problem: status.problem });
}

async function vapid(req, res) {
  const status = pushStatus();
  return res.json({ publicKey: status.publicKey, configured: status.configured });
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
  const subscriptions = scopedRepo(userId).pushSubscriptions;
  const row = { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } };
  if (userAgent) row.userAgent = String(userAgent).slice(0, 400);
  const upsert = () =>
    subscriptions.findOneAndUpdate({ endpoint: sub.endpoint }, { $set: row }, {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    });
  await devicesRepo.releaseFromOtherAccounts(sub.endpoint, userId);
  try {
    return await upsert();
  } catch (err) {
    if (err.code !== 11000) throw err;
    await devicesRepo.releaseFromOtherAccounts(sub.endpoint, userId);
    return upsert();
  }
}

async function subscribe(req, res) {
  try {
    const sub = req.body.subscription;
    const problem = subscriptionProblem(sub);
    if (problem) return res.status(400).json({ error: problem });
    const subscriptions = scopedRepo(req.user._id).pushSubscriptions;
    const replaces = typeof req.body.replaces === "string" ? req.body.replaces : null;
    if (replaces && replaces !== sub.endpoint) {
      await subscriptions.deleteOne({ endpoint: replaces });
    }
    await bindDevice(req.user._id, sub, req.headers["user-agent"]);
    const devices = await subscriptions.countDocuments({});
    return res.status(201).json({ ok: true, devices });
  } catch (err) {
    console.error("push subscribe error:", err.message);
    return res.status(500).json({ error: "Failed to subscribe" });
  }
}

async function resubscribe(req, res) {
  try {
    const oldEndpoint = req.body.oldEndpoint;
    const sub = req.body.subscription;
    if (typeof oldEndpoint !== "string" || !oldEndpoint || oldEndpoint.length > 2048) {
      return res.status(400).json({ error: "oldEndpoint required" });
    }
    const problem = subscriptionProblem(sub);
    if (problem) return res.status(400).json({ error: problem });

    const owner = await devicesRepo.ownerOfEndpoint(oldEndpoint);
    if (!owner) return res.status(404).json({ error: "That subscription is not known" });
    await devicesRepo.forgetEndpoint(oldEndpoint);
    await bindDevice(owner, sub, req.headers["user-agent"]);
    return res.json({ ok: true });
  } catch (err) {
    console.error("push resubscribe error:", err.message);
    return res.status(500).json({ error: "Failed to resubscribe" });
  }
}

async function devices(req, res) {
  try {
    const rows = await scopedRepo(req.user._id).pushSubscriptions.find({})
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
    const endpoint = req.body.endpoint;
    if (!endpoint) return res.status(400).json({ error: "endpoint required" });
    await scopedRepo(req.user._id).pushSubscriptions.deleteOne({ endpoint });
    return res.json({ ok: true });
  } catch (err) {
    console.error("push unsubscribe error:", err.message);
    return res.status(500).json({ error: "Failed to unsubscribe" });
  }
}

function notConfigured(res, problem) {
  return res.status(503).json({
    error: `Push is not set up on the server: ${problem || "the VAPID keys are missing"}. Nothing was sent.`,
    code: "not_configured",
    problem: problem || null,
  });
}

function reportOf(result, testId, mine) {
  const results = result.results.map((r) => ({
    id: r.id,
    device: r.device,
    host: r.host,
    thisDevice: r.thisDevice,
    delivered: r.delivered,
    status: r.status,
    reason: r.reason,
    removed: r.removed,
    renew: r.renew,
  }));
  const own = results.find((r) => r.thisDevice);
  let thisDevice = null;
  if (mine) {
    thisDevice = own
      ? { registered: true, ...own }
      : {
          registered: false,
          delivered: false,
          renew: true,
          reason: "This device is not registered for notifications on this account, so it was not sent here.",
        };
  }
  return {
    testId,
    devices: result.devices,
    delivered: result.sent,
    refused: result.devices - result.sent,
    removed: result.pruned,
    results,
    thisDevice,
  };
}

async function test(req, res) {
  try {
    const status = pushStatus();
    if (!status.configured) return notConfigured(res, status.problem);

    const mine = typeof req.body.endpoint === "string" && req.body.endpoint ? req.body.endpoint : null;
    const testId = crypto.randomBytes(8).toString("hex");
    const result = await notifyUser(
      req.user._id,
      {
        title: "LedgerWatch test notification",
        body: "If you can see this, notifications are working on this device.",
        tag: "test",
        type: "test",
        url: "/app/settings?section=notifications",
        testId,
      },
      null,
      { thisEndpoint: mine }
    );
    if (result.skipped) return notConfigured(res, result.problem);
    if (result.devices === null) {
      return res.status(500).json({ error: result.error || "The devices for this account could not be read.", code: "devices_unreadable" });
    }

    const report = reportOf(result, testId, mine);
    if (result.devices === 0) {
      return res.status(404).json({
        error:
          "No device is registered for notifications on this account, so nothing was sent. Press Enable notifications on the device that should receive them.",
        code: "no_devices",
        ...report,
      });
    }
    if (result.sent === 0) {
      return res.status(502).json({
        error: `The push service refused every registered device (${result.devices}), so nothing was sent.`,
        code: "all_refused",
        ...report,
      });
    }
    return res.json({ ok: true, ...report });
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
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: "token required" });

    let claims;
    try {
      claims = verifyActionToken(token);
    } catch {
      return res.status(401).json({ error: "Invalid or expired action token" });
    }

    const requested = req.body.action;
    if (requested && String(requested) !== claims.act) {
      return res.status(400).json({ error: "That button does not match its token" });
    }

    if (!spendToken(token)) {
      return res.status(409).json({ error: "That notification action has already been used." });
    }

    const user = await accounts.findById(claims.sub).select("-passwordHash");
    if (!user) return res.status(401).json({ error: "User no longer exists" });
    const repo = scopedRepo(user._id);

    if (claims.act === "dismiss_alert") {
      await repo.alerts.updateOne(
        { _id: claims.ref, status: "pending" },
        { $set: { status: "dismissed", userAction: "dismiss", actedAt: new Date() } }
      );
      return res.json({ ok: true, act: claims.act });
    }

    if (claims.act === "send_whatsapp" || claims.act === "send_email") {
      const debt = await repo.debts.findById(claims.ref);
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

module.exports = { key, vapid, subscribe, resubscribe, devices, unsubscribe, test, action, bindDevice };
