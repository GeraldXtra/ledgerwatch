const jwt = require("jsonwebtoken");
const PushSubscription = require("../models/PushSubscription");
const User = require("../models/User");

let webpush = null;
let configured = false;
let initTried = false;

function getWebPush() {
  if (initTried) return configured ? webpush : null;
  initTried = true;

  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.log("[push] VAPID keys not set — push disabled (in-app toasts still work).");
    return null;
  }

  try {
     
    webpush = require("web-push");
    webpush.setVapidDetails(
      VAPID_SUBJECT || "mailto:admin@ledgerwatch.app",
      VAPID_PUBLIC_KEY,
      VAPID_PRIVATE_KEY
    );
    configured = true;
    return webpush;
  } catch (err) {
    console.error("[push] failed to init web-push:", err.message);
    return null;
  }
}

const pushConfigured = () => Boolean(getWebPush());
const publicKey = () => process.env.VAPID_PUBLIC_KEY || null;

function signActionToken(userId, act, ref) {
  return jwt.sign(
    { sub: String(userId), act, ref: String(ref), kind: "push_action" },
    process.env.JWT_SECRET,
    { expiresIn: "15m", algorithm: "HS256" }
  );
}

function verifyActionToken(token) {
  const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ["HS256"] });
  if (decoded.kind !== "push_action") throw new Error("Not a push action token");
  return decoded;
}

async function wantsCategory(userId, category) {
  try {
    const user = await User.findById(userId).select("notifyPrefs").lean();
    const prefs = (user && user.notifyPrefs) || {};
    return prefs[category] !== false;
  } catch (err) {
    console.error(
      `[push] could not read notification preferences for ${userId} (${err.message}); ` +
        `holding back the "${category}" notification rather than assuming consent`
    );
    return false;
  }
}

const DEFAULT_PUSH_TTL = 24 * 60 * 60;

async function notifyUser(userId, payload, category, opts = {}) {
  const wp = getWebPush();
  if (!wp) return { sent: 0, skipped: true };

  if (category && !(await wantsCategory(userId, category))) {
    return { sent: 0, skipped: true };
  }

  let subs;
  try {
    subs = await PushSubscription.find({ userId });
  } catch (err) {
    console.error("[push] failed to load subscriptions:", err.message);
    return { sent: 0 };
  }

  if (subs.length === 0) {
    console.log(`[push] no subscriptions for user ${userId} — nothing to deliver`);
    return { sent: 0 };
  }

  const body = JSON.stringify(payload);
  const options = {
    TTL: Number.isFinite(opts.ttl) ? opts.ttl : DEFAULT_PUSH_TTL,
    urgency: opts.urgency || "high",
  };
  if (payload && payload.tag) options.topic = String(payload.tag).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) || undefined;
  let sent = 0;
  let pruned = 0;

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await wp.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, body, options);
        sent++;
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          await PushSubscription.deleteOne({ _id: sub._id }).catch(() => {});
          pruned++;
        } else {
          console.error("[push] send failed:", err.statusCode || err.message);
        }
      }
    })
  );

  if (pruned) {
    console.log(`[push] pruned ${pruned} dead subscription(s) for user ${userId}`);
  }
  console.log(`[push] delivered ${sent}/${subs.length} for user ${userId}`);

  return { sent, pruned };
}

function initPush() {
  const wp = getWebPush();
  console.log(
    wp
      ? "[push] Web Push configured and ready."
      : "[push] Web Push disabled — in-app toasts only."
  );
  return Boolean(wp);
}

module.exports = {
  pushConfigured,
  publicKey,
  signActionToken,
  verifyActionToken,
  notifyUser,
  initPush,
};
