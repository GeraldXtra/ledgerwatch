import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../http", () => ({ default: { get: vi.fn(), post: vi.fn() } }));

const TOKEN = `fcm-token-${"a".repeat(120)}`;

let http;
let store;
let plugin;
let handlers;

function fakePlugin({ permission = "granted", prompt = "granted" } = {}) {
  handlers = new Map();
  let current = permission;
  plugin = {
    checkPermissions: vi.fn(async () => ({ receive: current })),
    requestPermissions: vi.fn(async () => {
      current = prompt;
      return { receive: current };
    }),
    createChannel: vi.fn(async () => {}),
    register: vi.fn(async () => {
      setTimeout(() => {
        const fn = handlers.get("registration");
        if (fn) fn({ value: TOKEN });
      }, 0);
    }),
    unregister: vi.fn(async () => {}),
    addListener: vi.fn(async (name, fn) => {
      handlers.set(name, fn);
      return { remove: () => handlers.delete(name) };
    }),
  };
  return plugin;
}

function install(opts) {
  store = new Map();
  vi.stubGlobal("window", {
    isSecureContext: true,
    Capacitor: { isNativePlatform: () => true, getPlatform: () => "android", Plugins: { PushNotifications: fakePlugin(opts) } },
    matchMedia: () => ({ matches: false }),
    dispatchEvent: () => true,
  });
  vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Linux; Android 14) Chrome/130.0.0.0 Mobile LedgerWatchApp/1.0.0" });
  vi.stubGlobal("localStorage", {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  });
}

async function load() {
  vi.resetModules();
  http = (await import("../http")).default;
  http.get.mockReset();
  http.post.mockReset();
  http.get.mockImplementation(async (url) => {
    if (url === "/api/push/key") return { data: { publicKey: null, configured: false, native: { configured: true, projectId: "ledgerwatch-test", problem: null } } };
    if (url === "/api/push/devices") return { data: { devices: store.has("ledgerwatch.push.native") ? [{ kind: "app", token: store.get("ledgerwatch.push.native") }] : [] } };
    throw new Error(`unexpected GET ${url}`);
  });
  http.post.mockResolvedValue({ data: { ok: true, devices: 1 } });
  return import("../push.js");
}

beforeEach(() => install());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("LW-161 — inside the Android app, notifications go through Firebase", () => {
  it("is supported in the app even though the WebView has no Push API", async () => {
    const push = await load();
    expect(push.unsupportedReason()).toBeNull();
    const state = await push.getPushState();
    expect(state).toMatchObject({ supported: true, native: true, configured: true, subscribed: false, registered: false, permission: "granted" });
    expect(state.device).toMatchObject({ android: true, app: "mobile", installed: true });
  });

  it("asks the phone for permission, registers the token with the account, and remembers it", async () => {
    install({ permission: "prompt", prompt: "granted" });
    const push = await load();
    const out = await push.enablePush();
    expect(out).toMatchObject({ ok: true, token: TOKEN });
    expect(plugin.requestPermissions).toHaveBeenCalledTimes(1);
    expect(plugin.createChannel).toHaveBeenCalledWith(expect.objectContaining({ id: "ledgerwatch", importance: 4 }));
    expect(http.post).toHaveBeenCalledWith("/api/push/native", { platform: "android", token: TOKEN, replaces: undefined });
    const state = await push.getPushState();
    expect(state).toMatchObject({ subscribed: true, registered: true, deviceCount: 1 });
  });

  it("reports a refused permission without registering anything", async () => {
    install({ permission: "prompt", prompt: "denied" });
    const push = await load();
    expect(await push.enablePush()).toMatchObject({ ok: false, reason: "denied" });
    expect(plugin.register).not.toHaveBeenCalled();
    expect(http.post).not.toHaveBeenCalled();
  });

  it("re-registers on load when permission is already granted, and not after notifications were turned off here", async () => {
    const push = await load();
    expect(await push.syncPush({ force: true })).toMatchObject({ ok: true, endpoint: TOKEN });
    expect(plugin.requestPermissions).not.toHaveBeenCalled();
    const off = await push.disablePush();
    expect(off.ok).toBe(true);
    expect(http.post).toHaveBeenCalledWith("/api/push/native/forget", { token: TOKEN });
    expect(plugin.unregister).toHaveBeenCalled();
    expect(await push.syncPush({ force: true })).toMatchObject({ ok: false, reason: "off-here" });
  });

  it("sends the test to this phone by its token and hears the phone receive it", async () => {
    const push = await load();
    const native = await import("../nativePush.js");
    native.startNativeListening();
    http.post.mockImplementation(async (url) => {
      if (url === "/api/push/test") {
        return { data: { ok: true, testId: "5555555555555555", devices: 1, delivered: 1, thisDevice: { registered: true, delivered: true, device: "LedgerWatch app on Android" } } };
      }
      return { data: { ok: true, devices: 1 } };
    });
    const run = await push.runPushTest({ waitMs: 2000 });
    expect(http.post).toHaveBeenCalledWith("/api/push/test", { token: TOKEN });
    expect(run.report.thisDevice.delivered).toBe(true);
    handlers.get("pushNotificationReceived")({ title: "LedgerWatch test notification", body: "hi", data: { type: "test", testId: "5555555555555555" } });
    await expect(run.receipt).resolves.toMatchObject({ received: true, shown: true });
  });
});
