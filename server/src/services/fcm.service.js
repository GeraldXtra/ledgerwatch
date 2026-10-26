const crypto = require("crypto");
const NativeDevice = require("../models/NativeDevice");

const DEFAULT_TTL_SECONDS = 24 * 60 * 60;
const CHANNEL_ID = "ledgerwatch";
const STATUS_ICON = "ic_stat_ledgerwatch";
const ACCENT = "#FF9900";
const APP_NAME = "ledgerwatch";

let cached = { signature: null, config: null };
let adminApp = null;
let adminSignature = null;
let senderForTests = null;

function parseAccount(raw) {
  const text = String(raw || "").trim();
  if (text.startsWith("{")) return JSON.parse(text);
  return JSON.parse(Buffer.from(text, "base64").toString("utf8"));
}

function buildConfig(raw) {
  if (!raw) {
    return { ok: false, missing: true, problem: "FIREBASE_SERVICE_ACCOUNT is not set, so the apps cannot receive notifications" };
  }
  let account;
  try {
    account = parseAccount(raw);
  } catch {
    return { ok: false, problem: "FIREBASE_SERVICE_ACCOUNT is not the JSON of a Firebase service account key" };
  }
  if (!account || account.type !== "service_account" || !account.project_id || !account.private_key || !account.client_email) {
    return {
      ok: false,
      problem:
        "FIREBASE_SERVICE_ACCOUNT does not hold a service account key (type, project_id, client_email and private_key); " +
        "the phone's google-services.json is a different file",
    };
  }
  return { ok: true, account, projectId: account.project_id };
}

function fcmConfig() {
  const raw = String(process.env.FIREBASE_SERVICE_ACCOUNT || "");
  const signature = crypto.createHash("sha256").update(raw).digest("hex");
  if (cached.signature === signature) return cached.config;
  const config = buildConfig(raw);
  cached = { signature, config };
  if (!config.ok && !config.missing) console.error(`[fcm] ${config.problem}.`);
  return config;
}

function fcmStatus() {
  const config = fcmConfig();
  return { configured: config.ok, projectId: config.ok ? config.projectId : null, problem: config.ok ? null : config.problem };
}

function messagingFor(config) {
  if (senderForTests) return { send: senderForTests };
  const admin = require("firebase-admin");
  if (!adminApp || adminSignature !== cached.signature) {
    if (adminApp) {
      adminApp.delete().catch(() => {});
      adminApp = null;
    }
    adminApp = admin.initializeApp({ credential: admin.credential.cert(config.account) }, `${APP_NAME}-${Date.now()}`);
    adminSignature = cached.signature;
  }
  return admin.messaging(adminApp);
}

function stringData(payload, extra = {}) {
  const out = {};
  const source = { ...payload, ...extra };
  for (const [key, value] of Object.entries(source)) {
    if (value == null) continue;
    if (key === "actions" || key === "tokens" || key === "icon") continue;
    out[key] = typeof value === "string" ? value : JSON.stringify(value);
  }
  return out;
}

function messageFor(token, payload, { ttlSeconds }) {
  const title = String(payload.title || "LedgerWatch").slice(0, 200);
  const body = String(payload.body || "").slice(0, 1000);
  const tag = payload.tag ? String(payload.tag).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64) : undefined;
  return {
    token,
    notification: { title, body },
    data: stringData(payload, { title, body }),
    android: {
      priority: "high",
      ttl: Math.max(0, Number(ttlSeconds) || DEFAULT_TTL_SECONDS) * 1000,
      notification: {
        icon: STATUS_ICON,
        color: ACCENT,
        channelId: CHANNEL_ID,
        sound: "default",
        ...(tag ? { tag } : {}),
      },
    },
    apns: { payload: { aps: { sound: "default" } } },
  };
}

function platformLabel(platform) {
  return platform === "ios" ? "LedgerWatch app on iPhone" : "LedgerWatch app on Android";
}

function describeFcmError(err) {
  const code = String((err && (err.code || (err.errorInfo && err.errorInfo.code))) || "");
  const said = String((err && err.message) || "").replace(/\s+/g, " ").slice(0, 200);
  if (/registration-token-not-registered/.test(code)) {
    return {
      status: 404,
      removed: true,
      renew: true,
      detail: said,
      reason: "Firebase says this phone's token is no longer valid. The app was reinstalled, its data was cleared, or notifications were switched off for it. Open the app to register it again.",
    };
  }
  if (/invalid-registration-token|invalid-argument/.test(code)) {
    return { status: 400, removed: true, renew: true, detail: said, reason: "Firebase refused this phone's token as invalid. Open the app to register it again." };
  }
  if (/third-party-auth-error|authentication-error|invalid-credential|mismatched-credential/.test(code)) {
    return {
      status: 403,
      removed: false,
      renew: false,
      detail: said,
      reason: "Firebase refused the server's key (FIREBASE_SERVICE_ACCOUNT). It must be a service account key from the same Firebase project as the app.",
    };
  }
  if (/sender-id-mismatch/.test(code)) {
    return {
      status: 403,
      removed: true,
      renew: true,
      detail: said,
      reason: "This phone registered with a different Firebase project than the server's key. Reinstall the app built with this project's google-services.json.",
    };
  }
  if (/unavailable|internal-error|server-unavailable|quota-exceeded/.test(code)) {
    return { status: 503, removed: false, renew: false, detail: said, reason: "Firebase had a temporary problem. Try again shortly." };
  }
  if (/message-rate-exceeded|device-message-rate-exceeded/.test(code)) {
    return { status: 429, removed: false, renew: false, detail: said, reason: "Firebase is receiving too many messages for this phone. Try again in a few minutes." };
  }
  return { status: null, removed: false, renew: false, detail: said, reason: `Firebase answered ${code || "with an error"}${said ? `: ${said}` : ""}.` };
}

async function sendToDevices({ devices, payload, ttlSeconds, thisToken = null }) {
  const config = fcmConfig();
  if (!config.ok || !devices.length) return [];
  let messaging;
  try {
    messaging = messagingFor(config);
  } catch (err) {
    console.error("[fcm] could not start Firebase messaging:", err.message);
    return devices.map((d) => ({
      id: String(d._id),
      device: platformLabel(d.platform),
      host: "fcm.googleapis.com",
      thisDevice: Boolean(thisToken && d.token === thisToken),
      delivered: false,
      status: null,
      removed: false,
      renew: false,
      reason: `Firebase could not be started on the server: ${err.message}`,
    }));
  }
  return Promise.all(
    devices.map(async (d) => {
      const base = {
        id: String(d._id),
        device: platformLabel(d.platform),
        host: "fcm.googleapis.com",
        thisDevice: Boolean(thisToken && d.token === thisToken),
      };
      try {
        const messageId = await messaging.send(messageFor(d.token, payload, { ttlSeconds }));
        return { ...base, delivered: true, status: 200, removed: false, renew: false, reason: null, messageId };
      } catch (err) {
        const refusal = describeFcmError(err);
        if (refusal.removed) {
          try {
            await NativeDevice.deleteOne({ _id: d._id });
          } catch (deleteErr) {
            console.error(`[fcm] could not remove the refused device ${d._id}:`, deleteErr.message);
            refusal.removed = false;
          }
        }
        console.error(
          `[fcm] refused device ${d._id} (${base.device}): ${refusal.status || "no answer"}${refusal.detail ? ` "${refusal.detail}"` : ""}` +
            (refusal.removed ? "; the device was removed" : "")
        );
        return { ...base, delivered: false, ...refusal };
      }
    })
  );
}

function _setSenderForTests(fn) {
  senderForTests = fn;
}

function _resetForTests() {
  cached = { signature: null, config: null };
  senderForTests = null;
}

module.exports = {
  CHANNEL_ID,
  fcmConfig,
  fcmStatus,
  messageFor,
  describeFcmError,
  sendToDevices,
  platformLabel,
  _setSenderForTests,
  _resetForTests,
};
