import http from "./http";
import { API_BASE } from "./base";

const log = (stage, detail) =>
  console.info(`[push] ${stage}${detail !== undefined ? ": " : ""}`, detail ?? "");
const warn = (stage, err) => console.warn(`[push] ${stage}:`, err && (err.message || err));

export function pushSupported() {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function unsupportedReason() {
  if (typeof window === "undefined") return "Not running in a browser.";
  if (!window.isSecureContext) {
    return "Push needs a secure context. Use https, or localhost for development.";
  }
  if (!("serviceWorker" in navigator)) return "This browser has no service worker support.";
  if (!("PushManager" in window)) return "This browser has no Push API support.";
  if (!("Notification" in window)) return "This browser has no Notification API support.";
  return null;
}

const OFF_KEY = "ledgerwatch.push.off";
const ENDPOINT_KEY = "ledgerwatch.push.endpoint";
const SYNC_EVERY_MS = 10 * 60 * 1000;
let lastSyncAt = 0;
let syncing = null;

function readStore(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStore(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    return;
  }
}

export function pushTurnedOffHere() {
  return readStore(OFF_KEY) === "1";
}

function sameKey(subscription, publicKey) {
  try {
    const current = subscription.options && subscription.options.applicationServerKey;
    if (!current) return true;
    const a = new Uint8Array(current);
    const b = urlBase64ToUint8Array(publicKey);
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  } catch {
    return true;
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;

  log("registering", "/sw.js");
  const reg = await navigator.serviceWorker.register(
    `/sw.js?api=${encodeURIComponent(API_BASE)}`,
    { scope: "/" }
  );

  if (reg.installing) log("installing");
  else if (reg.waiting) log("waiting");
  else if (reg.active) log("already active");

  const ready = await navigator.serviceWorker.ready;
  log("activated", ready.scope);
  return ready;
}

export async function getPushState() {
  const reason = unsupportedReason();
  if (reason) {
    return {
      supported: false,
      configured: false,
      subscribed: false,
      permission: "unsupported",
      reason,
    };
  }

  let configured = false;
  try {
    const { data } = await http.get("/api/push/key");
    configured = Boolean(data.publicKey);
  } catch (err) {
    warn("could not read the server VAPID key", err);
    configured = false;
  }

  let subscribed = false;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg) subscribed = Boolean(await reg.pushManager.getSubscription());
  } catch (err) {
    warn("could not read the existing subscription", err);
  }

  return {
    supported: true,
    configured,
    subscribed,
    permission: Notification.permission,
    maxActions: typeof Notification !== "undefined" && "maxActions" in Notification
      ? Notification.maxActions
      : 2,
  };
}

export async function enablePush() {
  const reason = unsupportedReason();
  if (reason) {
    log("unsupported", reason);
    return { ok: false, reason: "unsupported", detail: reason };
  }

  let publicKey;
  try {
    const { data } = await http.get("/api/push/key");
    publicKey = data.publicKey;
  } catch (err) {
    warn("VAPID key request failed", err);
    return { ok: false, reason: "not-configured", detail: "Could not reach the server." };
  }
  if (!publicKey) {
    return { ok: false, reason: "not-configured", detail: "No VAPID keys set on the server." };
  }

  const permission = await Notification.requestPermission();
  log("permission", permission);
  if (permission !== "granted") {
    return { ok: false, reason: permission === "denied" ? "denied" : "dismissed" };
  }

  let reg;
  try {
    reg = await registerServiceWorker();
  } catch (err) {
    warn("service worker registration failed", err);
    return { ok: false, reason: "sw-failed", detail: err.message };
  }

  let sub;
  try {
    sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      log("subscribed", sub.endpoint.slice(0, 60) + "…");
    } else {
      log("reusing existing subscription", sub.endpoint.slice(0, 60) + "…");
    }
  } catch (err) {
    warn("subscribe failed", err);
    return { ok: false, reason: "subscribe-failed", detail: err.message };
  }

  try {
    const previous = readStore(ENDPOINT_KEY);
    await http.post("/api/push/subscribe", {
      subscription: sub.toJSON(),
      replaces: previous && previous !== sub.endpoint ? previous : undefined,
    });
    writeStore(ENDPOINT_KEY, sub.endpoint);
    writeStore(OFF_KEY, null);
    lastSyncAt = Date.now();
    log("stored on the server");
  } catch (err) {
    warn("could not store the subscription", err);
    return { ok: false, reason: "store-failed", detail: err?.response?.data?.error || err.message };
  }

  return { ok: true };
}

async function doSync(force) {
  if (!pushSupported() || unsupportedReason()) return { ok: false, reason: "unsupported" };
  if (Notification.permission !== "granted") return { ok: false, reason: "no-permission" };
  if (pushTurnedOffHere()) return { ok: false, reason: "off-here" };
  if (!force && Date.now() - lastSyncAt < SYNC_EVERY_MS) return { ok: true, reason: "recent" };

  let publicKey;
  try {
    const { data } = await http.get("/api/push/key");
    publicKey = data.publicKey;
  } catch (err) {
    warn("sync: VAPID key request failed", err);
    return { ok: false, reason: "no-key" };
  }
  if (!publicKey) return { ok: false, reason: "not-configured" };

  const reg = await registerServiceWorker();
  let sub = await reg.pushManager.getSubscription();
  const previous = readStore(ENDPOINT_KEY);
  if (sub && !sameKey(sub, publicKey)) {
    log("sync: the server key changed, renewing the subscription");
    await sub.unsubscribe().catch(() => {});
    sub = null;
  }
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
    log("sync: subscribed again", sub.endpoint.slice(0, 60) + "…");
  }

  await http.post("/api/push/subscribe", {
    subscription: sub.toJSON(),
    replaces: previous && previous !== sub.endpoint ? previous : undefined,
  });
  writeStore(ENDPOINT_KEY, sub.endpoint);
  lastSyncAt = Date.now();
  return { ok: true, endpoint: sub.endpoint };
}

export function syncPush({ force = false } = {}) {
  if (syncing) return syncing;
  syncing = doSync(force)
    .catch((err) => {
      warn("sync failed", err);
      return { ok: false, reason: "failed", detail: err?.response?.data?.error || err.message };
    })
    .finally(() => {
      syncing = null;
    });
  return syncing;
}

export async function releaseDeviceOnSignOut() {
  if (!pushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    const endpoint = (sub && sub.endpoint) || readStore(ENDPOINT_KEY);
    if (endpoint) await http.post("/api/push/unsubscribe", { endpoint });
  } catch (err) {
    warn("could not release this device on sign out", err);
  } finally {
    lastSyncAt = 0;
  }
}

export async function disablePush() {
  if (!pushSupported()) return { ok: true };
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return { ok: true };
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return { ok: true };

    const endpoint = sub.endpoint;

    try {
      await http.post("/api/push/unsubscribe", { endpoint });
    } catch (err) {
      warn("could not remove the subscription from the server", err);
      return {
        ok: false,
        reason: "server-unsubscribe-failed",
        detail: err?.response?.data?.error || err.message,
      };
    }

    writeStore(OFF_KEY, "1");
    writeStore(ENDPOINT_KEY, null);

    try {
      await sub.unsubscribe();
    } catch (err) {
      warn("the browser would not release the subscription", err);
      return { ok: false, reason: "browser-unsubscribe-failed", detail: err.message };
    }

    log("unsubscribed");
    return { ok: true };
  } catch (err) {
    warn("disable failed", err);
    return { ok: false, reason: "disable-failed", detail: err.message };
  }
}

export async function sendTestNotification() {
  const { data } = await http.post("/api/push/test");
  return data;
}

export function onForegroundPush(handler) {
  if (!("serviceWorker" in navigator)) return () => {};
  const listener = (event) => {
    const data = event.data || {};
    if (data.type === "push") handler({ kind: "push", payload: data.payload, shown: Boolean(data.shown) });
    else if (data.type === "push-resubscribed") handler({ kind: "resubscribed", endpoint: data.endpoint });
    else if (data.type === "action-result") handler({ kind: "action-result", ...data });
  };
  navigator.serviceWorker.addEventListener("message", listener);
  return () => navigator.serviceWorker.removeEventListener("message", listener);
}

export async function ensureServiceWorker() {
  if (!pushSupported()) return;
  try {
    await registerServiceWorker();
  } catch (err) {
    warn("background registration failed", err);
  }
}
