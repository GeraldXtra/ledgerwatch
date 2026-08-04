import http from "./http";

// The API base the service worker should call. Passed on the registration URL
// because a service worker cannot read Vite env or localStorage.
const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

/**
 * Every stage logs. Push has a lot of places to fail quietly — a registration
 * that never activates, a permission that was already denied, a subscribe that
 * throws, a POST that 400s — and none of them surface anywhere the user can see.
 * The whole pipeline sat dead for a long time precisely because nothing said so.
 */
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

/** Why push cannot work here, in words, or null when it can. */
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

// VAPID public keys are base64url; the browser needs a Uint8Array.
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * Register the service worker and wait for it to be ACTIVE.
 *
 * `navigator.serviceWorker.ready` is the part that matters: `register()` resolves
 * as soon as the registration exists, but `pushManager.subscribe()` needs an
 * activated worker. Subscribing too early is a classic intermittent failure.
 */
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

/** Is push supported, configured server-side, and subscribed on this device? */
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
    // maxActions is what actually governs how many buttons a notification can
    // show. Chrome desktop allows 2; assuming 3 silently drops the last one.
    maxActions: typeof Notification !== "undefined" && "maxActions" in Notification
      ? Notification.maxActions
      : 2,
  };
}

/**
 * Enable push for this browser. MUST be called from a real user gesture — the
 * permission prompt is never shown on page load.
 *
 * Returns a structured result rather than throwing, so the caller can always say
 * something specific about what went wrong.
 */
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

  // ALWAYS re-POST, even when reusing. The browser rotates endpoints, the server
  // row can be pruned after a 410, and a subscription the browser still holds may
  // be one the server has never seen. Upsert by endpoint makes this idempotent.
  try {
    await http.post("/api/push/subscribe", { subscription: sub.toJSON() });
    log("stored on the server");
  } catch (err) {
    warn("could not store the subscription", err);
    return { ok: false, reason: "store-failed", detail: err?.response?.data?.error || err.message };
  }

  return { ok: true };
}

export async function disablePush() {
  if (!pushSupported()) return { ok: true };
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg) {
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe().catch(() => {});
        await http.post("/api/push/unsubscribe", { endpoint }).catch(() => {});
        log("unsubscribed");
      }
    }
  } catch (err) {
    warn("disable failed", err);
  }
  return { ok: true };
}

export async function sendTestNotification() {
  const { data } = await http.post("/api/push/test");
  return data;
}

/**
 * Foreground bridge: while a window is focused the service worker suppresses the
 * OS notification and posts the payload here instead, so the user sees a single
 * in-app toast rather than being told the same thing twice.
 *
 * Also carries `action-result` messages, so tapping a notification button reports
 * back into the app when it is next looked at.
 */
export function onForegroundPush(handler) {
  if (!("serviceWorker" in navigator)) return () => {};
  const listener = (event) => {
    const data = event.data || {};
    if (data.type === "push") handler({ kind: "push", payload: data.payload });
    else if (data.type === "action-result") handler({ kind: "action-result", ...data });
  };
  navigator.serviceWorker.addEventListener("message", listener);
  return () => navigator.serviceWorker.removeEventListener("message", listener);
}

/**
 * Register the service worker on load whenever it is supported.
 *
 * Previously this returned early unless permission was ALREADY granted, which
 * meant `navigator.serviceWorker.ready` never resolved for a first-time user and
 * the worker only appeared at the moment they clicked enable. Registering early
 * is harmless — a worker with no subscription receives nothing — and it means the
 * enable click has an activated worker waiting for it.
 */
export async function ensureServiceWorker() {
  if (!pushSupported()) return;
  try {
    await registerServiceWorker();
  } catch (err) {
    warn("background registration failed", err);
  }
}
