const jwt = require("jsonwebtoken");
const PushSubscription = require("../models/PushSubscription");

// Lazy web-push init so the app runs fine with no VAPID keys configured — every
// send simply no-ops. Mirrors the graceful-degradation pattern in notify.service.
let webpush = null;
let configured = false;
let initTried = false;

function getWebPush() {
  if (initTried) return configured ? webpush : null;
  initTried = true;

  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.log("[push] VAPID keys not set — push notifications disabled (graceful).");
    return null;
  }

  try {
    // eslint-disable-next-line global-require
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

function pushConfigured() {
  return Boolean(getWebPush());
}

function publicKey() {
  return process.env.VAPID_PUBLIC_KEY || null;
}

/**
 * Short-lived, single-purpose action token embedded in a push payload. Because a
 * service worker cannot read the JWT from localStorage, the notification carries
 * this token so its action buttons can call an authenticated endpoint. It is bound
 * to ONE action + ONE resource and expires quickly, so it cannot be replayed for
 * anything else.
 * @param {string} userId
 * @param {"send_whatsapp"|"send_email"|"approve"|"dismiss"} act
 * @param {string} ref  the debt id (reminder actions) or alert id (alert actions)
 */
function signActionToken(userId, act, ref) {
  return jwt.sign(
    { sub: String(userId), act, ref: String(ref), kind: "push_action" },
    process.env.JWT_SECRET,
    { expiresIn: "15m" }
  );
}

function verifyActionToken(token) {
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  if (decoded.kind !== "push_action") {
    throw new Error("Not a push action token");
  }
  return decoded; // { sub, act, ref }
}

/**
 * Send a push payload to every subscription of a user. Prunes subscriptions that
 * the push service reports as gone (404/410). Never throws.
 * @returns {Promise<{sent:number, skipped?:boolean}>}
 */
async function notifyUser(userId, payload) {
  const wp = getWebPush();
  if (!wp) return { sent: 0, skipped: true };

  let subs;
  try {
    subs = await PushSubscription.find({ userId });
  } catch (err) {
    console.error("[push] failed to load subscriptions:", err.message);
    return { sent: 0 };
  }

  const body = JSON.stringify(payload);
  let sent = 0;

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await wp.sendNotification(
          { endpoint: sub.endpoint, keys: sub.keys },
          body
        );
        sent++;
      } catch (err) {
        // 404/410 => the subscription is dead; remove it so we stop trying.
        if (err.statusCode === 404 || err.statusCode === 410) {
          await PushSubscription.deleteOne({ _id: sub._id }).catch(() => {});
        } else {
          console.error("[push] send failed:", err.statusCode || err.message);
        }
      }
    })
  );

  return { sent };
}

module.exports = {
  pushConfigured,
  publicKey,
  signActionToken,
  verifyActionToken,
  notifyUser,
};
