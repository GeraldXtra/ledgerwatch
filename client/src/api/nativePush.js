import http from "./http";

const TOKEN_KEY = "ledgerwatch.push.native";
const CHANNEL = { id: "ledgerwatch", name: "LedgerWatch", description: "Money received, trades, reminders and alerts", importance: 4, visibility: 1, vibration: true };
const REGISTER_TIMEOUT_MS = 20000;

const listeners = new Set();
let listening = null;

function capacitor() {
  return (typeof window !== "undefined" && window.Capacitor) || null;
}

function plugin() {
  const c = capacitor();
  if (!c || typeof c.isNativePlatform !== "function" || !c.isNativePlatform()) return null;
  return (c.Plugins && c.Plugins.PushNotifications) || null;
}

export function nativePushAvailable() {
  return Boolean(plugin());
}

export function nativePlatform() {
  const c = capacitor();
  const p = c && typeof c.getPlatform === "function" ? c.getPlatform() : "android";
  return p === "ios" ? "ios" : "android";
}

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

export function storedNativeToken() {
  return readStore(TOKEN_KEY);
}

function permissionWord(state) {
  if (state === "granted") return "granted";
  if (state === "denied") return "denied";
  return "default";
}

export async function nativePermission() {
  const p = plugin();
  if (!p) return "unsupported";
  try {
    const r = await p.checkPermissions();
    return permissionWord(r && r.receive);
  } catch {
    return "default";
  }
}

async function ensureChannel(p) {
  if (nativePlatform() !== "android" || typeof p.createChannel !== "function") return;
  try {
    await p.createChannel(CHANNEL);
  } catch (err) {
    console.warn("[push] the notification channel could not be created:", err && err.message);
  }
}

function waitForToken(p) {
  return new Promise((resolve, reject) => {
    let done = false;
    const handles = [];
    const finish = (fn, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      for (const h of handles) h.then((handle) => handle && handle.remove && handle.remove()).catch(() => {});
      fn(value);
    };
    const timer = setTimeout(() => finish(reject, new Error("The phone did not return a notification token in time.")), REGISTER_TIMEOUT_MS);
    handles.push(Promise.resolve(p.addListener("registration", (t) => finish(resolve, t && t.value))));
    handles.push(
      Promise.resolve(
        p.addListener("registrationError", (e) => finish(reject, new Error(String((e && (e.error || e.message)) || "registration failed"))))
      )
    );
    Promise.resolve(p.register()).catch((err) => finish(reject, err));
  });
}

export async function registerNative({ ask = true } = {}) {
  const p = plugin();
  if (!p) return { ok: false, reason: "unsupported" };
  let permission = await nativePermission();
  if (permission !== "granted") {
    if (!ask) return { ok: false, reason: "no-permission", permission };
    try {
      const r = await p.requestPermissions();
      permission = permissionWord(r && r.receive);
    } catch (err) {
      return { ok: false, reason: "subscribe-failed", detail: err && err.message };
    }
    if (permission !== "granted") return { ok: false, reason: permission === "denied" ? "denied" : "dismissed" };
  }
  await ensureChannel(p);
  let token;
  try {
    token = await waitForToken(p);
  } catch (err) {
    return { ok: false, reason: "subscribe-failed", detail: err && err.message };
  }
  if (!token) return { ok: false, reason: "subscribe-failed", detail: "The phone returned an empty token." };
  const previous = storedNativeToken();
  try {
    const { data } = await http.post("/api/push/native", {
      platform: nativePlatform(),
      token,
      replaces: previous && previous !== token ? previous : undefined,
    });
    writeStore(TOKEN_KEY, token);
    return { ok: true, token, devices: data && data.devices, renewed: Boolean(previous && previous !== token) };
  } catch (err) {
    const detail = (err && err.response && err.response.data && err.response.data.error) || (err && err.message);
    return { ok: false, reason: "store-failed", detail, token };
  }
}

export async function forgetNative() {
  const p = plugin();
  const token = storedNativeToken();
  if (token) {
    try {
      await http.post("/api/push/native/forget", { token });
    } catch (err) {
      return { ok: false, reason: "server-unsubscribe-failed", detail: (err && err.response && err.response.data && err.response.data.error) || (err && err.message) };
    }
  }
  writeStore(TOKEN_KEY, null);
  if (p && typeof p.unregister === "function") {
    try {
      await p.unregister();
    } catch {
      return { ok: true };
    }
  }
  return { ok: true };
}

export function onNativeMessage(handler) {
  listeners.add(handler);
  return () => listeners.delete(handler);
}

function emit(message) {
  for (const fn of listeners) {
    try {
      fn(message);
    } catch (err) {
      console.warn("[push] a listener failed:", err && err.message);
    }
  }
}

function payloadOf(notification) {
  const data = (notification && notification.data) || {};
  return {
    title: notification && notification.title ? notification.title : data.title || "LedgerWatch",
    body: notification && notification.body ? notification.body : data.body || "",
    url: data.url || "/app",
    tag: data.tag || null,
    type: data.type || "info",
    testId: data.testId || null,
    alertId: data.alertId || null,
  };
}

export function startNativeListening() {
  const p = plugin();
  if (!p || listening) return listening || (() => {});
  const handles = [
    Promise.resolve(p.addListener("pushNotificationReceived", (n) => emit({ kind: "push", payload: payloadOf(n), shown: true, at: Date.now() }))),
    Promise.resolve(
      p.addListener("pushNotificationActionPerformed", (a) => emit({ kind: "open", payload: payloadOf(a && a.notification), at: Date.now() }))
    ),
  ];
  listening = () => {
    for (const h of handles) h.then((handle) => handle && handle.remove && handle.remove()).catch(() => {});
    listening = null;
  };
  return listening;
}
