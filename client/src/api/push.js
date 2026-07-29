import http from "./http";

// The API base the service worker should call. Passed on the registration URL
// because a service worker cannot read Vite env or localStorage.
const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

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
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  return navigator.serviceWorker.register(`/sw.js?api=${encodeURIComponent(API_BASE)}`, {
    scope: "/",
  });
}

/** Is push supported, configured server-side, and subscribed on this device? */
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
    if (reg) subscribed = Boolean(await reg.pushManager.getSubscription());
  } catch {
    subscribed = false;
  }
  return { supported: true, configured, subscribed, permission: Notification.permission };
}

/**
 * Enable push for this browser. MUST be called from a real user gesture — the
 * permission prompt is never shown on page load.
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
    /* best effort */
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
 */
export function onForegroundPush(handler) {
  if (!("serviceWorker" in navigator)) return () => {};
  const listener = (event) => {
    if (event.data && event.data.type === "push") handler(event.data.payload);
  };
  navigator.serviceWorker.addEventListener("message", listener);
  return () => navigator.serviceWorker.removeEventListener("message", listener);
}

/** Registers the SW on load if the user already granted permission previously. */
export async function ensureServiceWorker() {
  if (!pushSupported()) return;
  if (Notification.permission !== "granted") return;
  try {
    await registerServiceWorker();
  } catch {
    /* non-fatal */
  }
}
