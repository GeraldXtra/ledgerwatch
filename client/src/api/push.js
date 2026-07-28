import http from "./http";

// The API base the service worker should call. Passed on the SW registration URL so
// it persists across SW restarts. Mirrors http.js's baseURL resolution.
const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:5000";

export function pushSupported() {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

// VAPID public keys are base64url; the browser needs a Uint8Array.
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

// Register (or reuse) the service worker. Query string carries the API base.
export async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  const url = `/sw.js?api=${encodeURIComponent(API_BASE)}`;
  return navigator.serviceWorker.register(url, { scope: "/" });
}

// Current state: is push supported, is the server configured, is this browser subscribed?
export async function getPushState() {
  if (!pushSupported()) {
    return { supported: false, configured: false, subscribed: false, permission: "unsupported" };
  }
  let configured = false;
  try {
    const { data } = await http.get("/api/push/key");
    configured = Boolean(data.publicKey);
  } catch {
    configured = false;
  }
  let subscribed = false;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg) {
      const sub = await reg.pushManager.getSubscription();
      subscribed = Boolean(sub);
    }
  } catch {
    subscribed = false;
  }
  return { supported: true, configured, subscribed, permission: Notification.permission };
}

/**
 * Enable push for this browser. MUST be called from a user gesture (permission
 * prompt). Registers the SW, requests permission, subscribes with the server's
 * VAPID key, and persists the subscription server-side.
 * @returns {Promise<{ok:boolean, reason?:string}>}
 */
export async function enablePush() {
  if (!pushSupported()) return { ok: false, reason: "unsupported" };

  const { data } = await http.get("/api/push/key");
  if (!data.publicKey) return { ok: false, reason: "not-configured" };

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { ok: false, reason: "denied" };

  const reg = await registerServiceWorker();
  await navigator.serviceWorker.ready;

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(data.publicKey),
    });
  }

  await http.post("/api/push/subscribe", { subscription: sub.toJSON() });
  return { ok: true };
}

// Disable push for this browser: unsubscribe locally and remove server-side.
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
      }
    }
  } catch {
    /* best-effort */
  }
  return { ok: true };
}
