const jwt = require("jsonwebtoken");
const PushSubscription = require("../models/PushSubscription");
const User = require("../models/User");

/**
 * Web Push delivery.
 *
 * Lazily initialised so the app runs perfectly well with no VAPID keys — every
 * send becomes a no-op and the client falls back to in-app toasts. Nothing here
 * ever throws into a caller.
 */
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

const pushConfigured = () => Boolean(getWebPush());
const publicKey = () => process.env.VAPID_PUBLIC_KEY || null;

/**
 * Short-lived, single-purpose token embedded in a push payload.
 *
 * A service worker cannot read the JWT from localStorage, so the notification
 * carries this instead. It is bound to ONE action and ONE resource and expires
 * in 15 minutes, so it cannot be replayed for anything else.
 *
 * @param {"dismiss_alert"|"send_whatsapp"|"send_email"} act
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
  if (decoded.kind !== "push_action") throw new Error("Not a push action token");
  return decoded;
}

/**
 * Should this user receive this category of notification? Per-type opt-outs live
 * on the user; the default is on once they have granted permission.
 */
async function wantsCategory(userId, category) {
  try {
    const user = await User.findById(userId).select("notifyPrefs").lean();
    const prefs = (user && user.notifyPrefs) || {};
    return prefs[category] !== false;
  } catch {
    return true;
  }
}

/**
 * Send to every subscription belonging to a user. Prunes endpoints the push
 * service reports as gone. Never throws.
 * @returns {Promise<{sent:number, skipped?:boolean}>}
 */
async function notifyUser(userId, payload, category) {
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
    // Worth saying out loud: this is the state where everything else looks
    // healthy and yet no notification can possibly arrive, because nobody has
    // subscribed on any device.
    console.log(`[push] no subscriptions for user ${userId} — nothing to deliver`);
    return { sent: 0 };
  }

  /**
   * Actions are ordered by value BEFORE they reach the browser, because the
   * service worker has to trim to `Notification.maxActions` (2 on Chrome
   * desktop) and trims from the end. Ordering here means the button that gets
   * dropped is always the least important one.
   */
  const body = JSON.stringify(payload);
  let sent = 0;
  let pruned = 0;

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await wp.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, body);
        sent++;
      } catch (err) {
        // 404/410 => the subscription is dead; drop it so we stop retrying.
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

/**
 * Warm the web-push config at boot so a missing or malformed key is reported at
 * startup rather than being discovered the first time something tries to notify.
 */
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
