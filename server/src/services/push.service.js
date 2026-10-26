const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const PushSubscription = require("../models/PushSubscription");
const User = require("../models/User");

const DEFAULT_SUBJECT = "mailto:admin@ledgerwatch.app";
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const BARE_EMAIL = /^[^\s@:/]+@[^\s@/]+\.[^\s@/]+$/;
const SEND_TIMEOUT_MS = 15000;

let cached = { signature: null, config: null };

function decodeKey(value) {
  return value && BASE64URL.test(value) ? Buffer.from(value, "base64url") : null;
}

function readSubject(raw) {
  const value = String(raw || "").trim();
  if (!value) return { subject: DEFAULT_SUBJECT };
  const candidate = BARE_EMAIL.test(value) ? `mailto:${value}` : value;
  let parsed = null;
  try {
    parsed = new URL(candidate);
  } catch {
    parsed = null;
  }
  if (parsed && (parsed.protocol === "mailto:" || (parsed.protocol === "https:" && parsed.hostname !== "localhost"))) {
    return { subject: candidate };
  }
  return {
    subject: DEFAULT_SUBJECT,
    warning: `VAPID_SUBJECT is not a mailto: address or an https: link, so ${DEFAULT_SUBJECT} is used`,
  };
}

function buildConfig(publicKey, privateKey, rawSubject) {
  if (!publicKey && !privateKey) {
    return { ok: false, missing: true, problem: "VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are not set, so push is off" };
  }
  if (!privateKey) return { ok: false, problem: "VAPID_PRIVATE_KEY is not set, so the server cannot sign a push" };
  if (!publicKey) return { ok: false, problem: "VAPID_PUBLIC_KEY is not set, so no device can subscribe" };

  const pub = decodeKey(publicKey);
  if (!pub || pub.length !== 65 || pub[0] !== 4) {
    return { ok: false, problem: "VAPID_PUBLIC_KEY is not a URL-safe base64 P-256 public key (65 bytes)" };
  }
  const priv = decodeKey(privateKey);
  if (!priv || priv.length !== 32) {
    return { ok: false, problem: "VAPID_PRIVATE_KEY is not a URL-safe base64 P-256 private key (32 bytes)" };
  }
  let derived;
  try {
    const ecdh = crypto.createECDH("prime256v1");
    ecdh.setPrivateKey(priv);
    derived = ecdh.getPublicKey();
  } catch {
    return { ok: false, problem: "VAPID_PRIVATE_KEY is not a valid P-256 private key" };
  }
  if (!derived.equals(pub)) {
    return {
      ok: false,
      problem:
        "VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY do not belong together: the private key makes a different public key, " +
        "so every push service would refuse the server's signature (403). Set both from the same generated pair",
    };
  }
  const { subject, warning } = readSubject(rawSubject);
  return { ok: true, publicKey, privateKey, subject, warning: warning || null };
}

function vapidConfig() {
  const publicKey = String(process.env.VAPID_PUBLIC_KEY || "").trim();
  const privateKey = String(process.env.VAPID_PRIVATE_KEY || "").trim();
  const rawSubject = String(process.env.VAPID_SUBJECT || "");
  const signature = crypto.createHash("sha256").update(`${publicKey}\n${privateKey}\n${rawSubject}`).digest("hex");
  if (cached.signature === signature) return cached.config;
  const config = buildConfig(publicKey, privateKey, rawSubject);
  cached = { signature, config };
  if (!config.ok && !config.missing) console.error(`[push] ${config.problem}.`);
  if (config.ok && config.warning) console.warn(`[push] ${config.warning}.`);
  return config;
}

const pushConfigured = () => vapidConfig().ok;
const publicKey = () => {
  const config = vapidConfig();
  return config.ok ? config.publicKey : null;
};

function pushStatus() {
  const config = vapidConfig();
  return {
    configured: config.ok,
    publicKey: config.ok ? config.publicKey : null,
    problem: config.ok ? null : config.problem,
  };
}

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

function deviceLabel(userAgent) {
  const ua = String(userAgent || "");
  if (!ua) return "Unknown device";
  const browser = /EdgA?\/|EdgiOS\//.test(ua)
    ? "Edge"
    : /SamsungBrowser\//.test(ua)
      ? "Samsung Internet"
      : /OPR\/|Opera/.test(ua)
        ? "Opera"
        : /Firefox\/|FxiOS\//.test(ua)
          ? "Firefox"
          : /CriOS\/|Chrome\//.test(ua)
            ? "Chrome"
            : /Safari\//.test(ua)
              ? "Safari"
              : "Browser";
  const os = /Android/.test(ua)
    ? "Android"
    : /iPhone|iPod/.test(ua)
      ? "iPhone"
      : /iPad/.test(ua)
        ? "iPad"
        : /Windows/.test(ua)
          ? "Windows"
          : /CrOS/.test(ua)
            ? "ChromeOS"
            : /Mac OS X|Macintosh/.test(ua)
              ? "Mac"
              : /Linux/.test(ua)
                ? "Linux"
                : null;
  return os ? `${browser} on ${os}` : browser;
}

function hostOf(endpoint) {
  try {
    return new URL(String(endpoint)).hostname;
  } catch {
    return "unknown";
  }
}

function describeRefusal(err) {
  const status = Number(err && err.statusCode) || null;
  const said = String((err && err.body) || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
  const detail = said || null;
  if (status === 404 || status === 410) {
    return {
      status,
      removed: true,
      renew: true,
      detail,
      reason:
        "The push service says this subscription no longer exists. The app was reinstalled, its data was cleared, or notifications were switched off for it.",
    };
  }
  if (status === 401 || status === 403) {
    return {
      status,
      removed: true,
      renew: true,
      detail,
      reason:
        "The push service refused the server's signature for this subscription: it was made with a different server key (VAPID). The device has to subscribe again.",
    };
  }
  if (status === 413) {
    return { status, removed: false, renew: false, detail, reason: "The push service refused the message as too large." };
  }
  if (status === 429) {
    return {
      status,
      removed: false,
      renew: false,
      detail,
      reason: "The push service is receiving too many messages from this server. Try again in a few minutes.",
    };
  }
  if (status === 400) {
    return {
      status,
      removed: false,
      renew: false,
      detail,
      reason: `The push service refused the message as malformed${said ? `: ${said}` : ""}.`,
    };
  }
  if (status && status >= 500) {
    return {
      status,
      removed: false,
      renew: false,
      detail,
      reason: `The push service had a temporary problem (${status}). Try again shortly.`,
    };
  }
  if (status) {
    return { status, removed: false, renew: false, detail, reason: `The push service answered ${status}${said ? `: ${said}` : ""}.` };
  }
  return {
    status: null,
    removed: false,
    renew: false,
    detail: null,
    reason: `The push service could not be reached: ${String((err && err.message) || "no answer").slice(0, 160)}.`,
  };
}

const DEFAULT_PUSH_TTL = 24 * 60 * 60;

function sendOptions(config, payload, opts) {
  const options = {
    TTL: Number.isFinite(opts.ttl) ? opts.ttl : DEFAULT_PUSH_TTL,
    urgency: opts.urgency || "high",
    timeout: SEND_TIMEOUT_MS,
    vapidDetails: { subject: config.subject, publicKey: config.publicKey, privateKey: config.privateKey },
  };
  const topic = payload && payload.tag ? String(payload.tag).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) : "";
  if (topic) options.topic = topic;
  return options;
}

async function notifyUser(userId, payload, category, opts = {}) {
  const config = vapidConfig();
  if (!config.ok) {
    return { sent: 0, pruned: 0, devices: 0, results: [], skipped: true, reason: "not-configured", problem: config.problem };
  }
  const wp = require("web-push");

  if (category && !(await wantsCategory(userId, category))) {
    return { sent: 0, pruned: 0, devices: 0, results: [], skipped: true, reason: "category-off" };
  }

  let subs;
  try {
    subs = await PushSubscription.find({ userId }).lean();
  } catch (err) {
    console.error("[push] failed to load subscriptions:", err.message);
    return { sent: 0, pruned: 0, devices: null, results: [], error: "The devices for this account could not be read." };
  }

  if (subs.length === 0) {
    console.log(`[push] no subscriptions for user ${userId}, nothing to deliver`);
    return { sent: 0, pruned: 0, devices: 0, results: [] };
  }

  const body = JSON.stringify(payload);
  const options = sendOptions(config, payload, opts);
  const mine = typeof opts.thisEndpoint === "string" && opts.thisEndpoint ? opts.thisEndpoint : null;

  const results = await Promise.all(
    subs.map(async (sub) => {
      const base = {
        id: String(sub._id),
        device: deviceLabel(sub.userAgent),
        host: hostOf(sub.endpoint),
        thisDevice: Boolean(mine && sub.endpoint === mine),
      };
      try {
        const answer = await wp.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, body, options);
        return { ...base, delivered: true, status: (answer && answer.statusCode) || 201, removed: false, renew: false, reason: null };
      } catch (err) {
        const refusal = describeRefusal(err);
        if (refusal.removed) {
          try {
            await PushSubscription.deleteOne({ _id: sub._id });
          } catch (deleteErr) {
            console.error(`[push] could not remove the refused subscription ${sub._id}:`, deleteErr.message);
            refusal.removed = false;
          }
        }
        console.error(
          `[push] ${base.host} refused user ${userId} device ${sub._id} (${base.device}): ` +
            `${refusal.status || "no answer"}${refusal.detail ? ` "${refusal.detail}"` : ""}` +
            (refusal.removed ? "; the subscription was removed" : "")
        );
        return { ...base, delivered: false, ...refusal };
      }
    })
  );

  const sent = results.filter((r) => r.delivered).length;
  const pruned = results.filter((r) => r.removed).length;
  if (pruned) console.log(`[push] removed ${pruned} refused subscription(s) for user ${userId}`);
  console.log(`[push] delivered ${sent}/${subs.length} for user ${userId}`);

  return { sent, pruned, devices: subs.length, results };
}

function initPush() {
  const config = vapidConfig();
  if (config.ok) {
    console.log("[push] Web Push configured and ready.");
  } else {
    console.log(`[push] Web Push disabled (${config.problem}). In-app toasts still work.`);
    if (!config.missing) {
      require("./opsAlert.service")
        .reportProblem({ area: "push", message: `Push notifications are off: ${config.problem}.` })
        .catch(() => {});
    }
  }
  return config.ok;
}

module.exports = {
  pushConfigured,
  publicKey,
  pushStatus,
  signActionToken,
  verifyActionToken,
  notifyUser,
  deviceLabel,
  describeRefusal,
  initPush,
};
