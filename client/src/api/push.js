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

export function appShell() {
  const ua = (typeof navigator !== "undefined" && navigator.userAgent) || "";
  if (/LedgerWatchDesktop\//.test(ua)) return "desktop";
  if (/LedgerWatchApp\//.test(ua)) return "mobile";
  return null;
}

export function unsupportedReason() {
  if (typeof window === "undefined") return "Not running in a browser.";
  if (!window.isSecureContext) {
    return "Push needs a secure context. Use https, or localhost for development.";
  }
  const shell = appShell();
  if (shell && (!("serviceWorker" in navigator) || !("PushManager" in window))) {
    return shell === "desktop"
      ? "The desktop app shows alerts while it is open. Notifications that arrive when it is closed are not part of it yet; the website in Chrome or Edge has them."
      : "The LedgerWatch app shows alerts while it is open. Notifications that arrive when it is closed are not part of the app yet; the website installed from Chrome has them.";
  }
  if (!("serviceWorker" in navigator)) return "This browser has no service worker support.";
  if (!("PushManager" in window)) return "This browser has no Push API support.";
  if (!("Notification" in window)) return "This browser has no Notification API support.";
  return null;
}

export function deviceKind() {
  const ua = (typeof navigator !== "undefined" && navigator.userAgent) || "";
  const android = /Android/i.test(ua);
  const ios =
    /iPhone|iPad|iPod/i.test(ua) ||
    (/Macintosh/.test(ua) && typeof navigator !== "undefined" && navigator.maxTouchPoints > 1);
  const app = appShell();
  let installed = Boolean(app);
  try {
    installed =
      installed ||
      window.matchMedia("(display-mode: standalone)").matches ||
      window.matchMedia("(display-mode: minimal-ui)").matches ||
      navigator.standalone === true;
  } catch {
    installed = Boolean(app);
  }
  return { android, ios, installed, app };
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

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function subscriptionKeyMatches(subscription, publicKey) {
  let current;
  try {
    current = subscription && subscription.options && subscription.options.applicationServerKey;
  } catch {
    return null;
  }
  if (!current) return null;
  let a;
  let b;
  try {
    a = new Uint8Array(current);
    b = urlBase64ToUint8Array(publicKey);
  } catch {
    return null;
  }
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
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

async function readServerKey() {
  const { data } = await http.get("/api/push/key");
  return {
    publicKey: data && data.configured && data.publicKey ? data.publicKey : null,
    configured: Boolean(data && data.configured && data.publicKey),
    problem: (data && data.problem) || null,
  };
}

function failure(reason, err, extra = {}) {
  const detail =
    (err && err.response && err.response.data && err.response.data.error) ||
    (err && err.name && err.message ? `${err.name}: ${err.message}` : err && err.message) ||
    (typeof err === "string" ? err : undefined);
  return { ok: false, reason, detail, ...extra };
}

async function subscribeHere(publicKey, { renew = false } = {}) {
  let reg;
  try {
    reg = await registerServiceWorker();
  } catch (err) {
    warn("service worker registration failed", err);
    return failure("sw-failed", err);
  }
  if (!reg) return failure("sw-failed", "This browser has no service worker support.");

  let sub;
  let replaced = null;
  let renewed = false;
  try {
    sub = await reg.pushManager.getSubscription();
    const matches = sub ? subscriptionKeyMatches(sub, publicKey) : null;
    if (sub && (renew || matches === false)) {
      log(renew ? "renewing the subscription" : "the server key changed, renewing the subscription");
      replaced = sub.endpoint;
      renewed = true;
      await sub.unsubscribe().catch((err) => warn("the old subscription would not unsubscribe", err));
      sub = null;
    }
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      log("subscribed", sub.endpoint.slice(0, 60) + "...");
    }
  } catch (err) {
    warn("subscribe failed", err);
    return failure("subscribe-failed", err);
  }

  const previous = replaced || readStore(ENDPOINT_KEY);
  try {
    const { data } = await http.post("/api/push/subscribe", {
      subscription: sub.toJSON(),
      replaces: previous && previous !== sub.endpoint ? previous : undefined,
    });
    writeStore(ENDPOINT_KEY, sub.endpoint);
    lastSyncAt = Date.now();
    log("stored on the server");
    return { ok: true, endpoint: sub.endpoint, devices: data && data.devices, renewed };
  } catch (err) {
    warn("could not store the subscription", err);
    return failure("store-failed", err, { endpoint: sub.endpoint });
  }
}

export async function getPushState() {
  const reason = unsupportedReason();
  if (reason) {
    return {
      supported: false,
      configured: false,
      subscribed: false,
      registered: null,
      permission: "unsupported",
      reason,
      device: deviceKind(),
    };
  }

  let configured = false;
  let problem = null;
  let publicKey = null;
  try {
    const key = await readServerKey();
    configured = key.configured;
    problem = key.problem;
    publicKey = key.publicKey;
  } catch (err) {
    warn("could not read the server VAPID key", err);
    throw err;
  }

  let subscription = null;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg) subscription = await reg.pushManager.getSubscription();
  } catch (err) {
    warn("could not read the existing subscription", err);
  }

  let registered = null;
  let deviceCount = null;
  try {
    const { data } = await http.get("/api/push/devices");
    const list = (data && data.devices) || [];
    deviceCount = list.length;
    registered = subscription ? list.some((d) => d.endpoint === subscription.endpoint) : false;
  } catch (err) {
    warn("could not read the registered devices", err);
  }

  return {
    supported: true,
    configured,
    problem,
    subscribed: Boolean(subscription),
    keyMatches: subscription && publicKey ? subscriptionKeyMatches(subscription, publicKey) : null,
    registered,
    deviceCount,
    permission: Notification.permission,
    device: deviceKind(),
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

  let key;
  try {
    key = await readServerKey();
  } catch (err) {
    warn("VAPID key request failed", err);
    return failure("not-configured", err, { detail: "Could not reach the server." });
  }
  if (!key.configured) {
    return { ok: false, reason: "not-configured", detail: key.problem || "No VAPID keys set on the server." };
  }

  const permission = await Notification.requestPermission();
  log("permission", permission);
  if (permission !== "granted") {
    return { ok: false, reason: permission === "denied" ? "denied" : "dismissed" };
  }

  const out = await subscribeHere(key.publicKey);
  if (out.ok) writeStore(OFF_KEY, null);
  return out;
}

async function doSync(force, renew) {
  if (!pushSupported() || unsupportedReason()) return { ok: false, reason: "unsupported" };
  if (Notification.permission !== "granted") return { ok: false, reason: "no-permission", permission: Notification.permission };
  if (pushTurnedOffHere()) return { ok: false, reason: "off-here" };
  if (!force && Date.now() - lastSyncAt < SYNC_EVERY_MS) return { ok: true, reason: "recent" };

  let key;
  try {
    key = await readServerKey();
  } catch (err) {
    warn("sync: VAPID key request failed", err);
    return failure("no-key", err);
  }
  if (!key.configured) return { ok: false, reason: "not-configured", detail: key.problem };

  return subscribeHere(key.publicKey, { renew });
}

export function syncPush({ force = false, renew = false } = {}) {
  if (syncing && !renew) return syncing;
  const run = (syncing || Promise.resolve()).catch(() => null).then(() => doSync(force, renew));
  const tracked = run
    .catch((err) => {
      warn("sync failed", err);
      return failure("failed", err);
    })
    .finally(() => {
      if (syncing === tracked) syncing = null;
    });
  syncing = tracked;
  return tracked;
}

export function renewPush() {
  return syncPush({ force: true, renew: true });
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

export async function sendTestNotification(endpoint) {
  try {
    const { data } = await http.post("/api/push/test", endpoint ? { endpoint } : {});
    return { ok: true, ...data };
  } catch (err) {
    const data = err && err.response && err.response.data;
    if (data && typeof data === "object" && (data.code || typeof data.devices === "number")) {
      return { ...data, ok: false, httpStatus: err.response.status };
    }
    throw err;
  }
}

function watchForTests() {
  const seen = new Map();
  const waiters = new Map();
  const stop = onForegroundPush((message) => {
    if (message.kind !== "push") return;
    const payload = message.payload || {};
    if (payload.type !== "test" || !payload.testId) return;
    const receipt = { received: true, shown: Boolean(message.shown), error: message.error || null, at: message.at || Date.now() };
    seen.set(payload.testId, receipt);
    const waiter = waiters.get(payload.testId);
    if (waiter) waiter(receipt);
  });
  return {
    wait(testId, ms) {
      if (!testId) return Promise.resolve({ received: false, waited: 0 });
      if (seen.has(testId)) return Promise.resolve(seen.get(testId));
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          waiters.delete(testId);
          resolve({ received: false, waited: ms });
        }, ms);
        waiters.set(testId, (receipt) => {
          clearTimeout(timer);
          waiters.delete(testId);
          resolve(receipt);
        });
      });
    },
    stop,
  };
}

export async function runPushTest({ waitMs = 20000 } = {}) {
  const sync = await syncPush({ force: true });
  const endpoint = sync && sync.ok ? sync.endpoint : null;
  const watcher = watchForTests();
  try {
    let report = await sendTestNotification(endpoint);
    let renewed = null;
    if (endpoint && report.thisDevice && report.thisDevice.renew) {
      const again = await renewPush();
      renewed = { ok: again.ok, reason: again.reason, detail: again.detail, before: report };
      if (again.ok) report = await sendTestNotification(again.endpoint);
    }
    const expectHere = Boolean(report.thisDevice && report.thisDevice.delivered);
    const receipt = expectHere
      ? watcher.wait(report.testId, waitMs).finally(() => watcher.stop())
      : Promise.resolve(null).finally(() => watcher.stop());
    return { sync, report, renewed, receipt };
  } catch (err) {
    watcher.stop();
    throw err;
  }
}

export function onForegroundPush(handler) {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return () => {};
  const listener = (event) => {
    const data = event.data || {};
    if (data.type === "push") {
      handler({ kind: "push", payload: data.payload, shown: Boolean(data.shown), error: data.error || null, at: data.at || null });
    } else if (data.type === "push-resubscribed") handler({ kind: "resubscribed", endpoint: data.endpoint });
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
