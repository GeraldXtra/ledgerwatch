import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Buffer } from "buffer";

vi.mock("../http", () => ({ default: { get: vi.fn(), post: vi.fn() } }));

const toB64Url = (bytes) => Buffer.from(bytes).toString("base64url");
const keyBytes = (fill) => {
  const out = new Uint8Array(65);
  out[0] = 4;
  for (let i = 1; i < 65; i++) out[i] = (fill * 7 + i) % 256;
  return out;
};
const CURRENT_KEY = toB64Url(keyBytes(1));
const OLD_KEY = toB64Url(keyBytes(2));

let browser;
let http;
let store;

function fakeBrowser({ existingKey = null } = {}) {
  let seq = 0;
  let current = null;
  const listeners = new Set();
  const makeSub = (bytes, name) => {
    const endpoint = `https://fcm.googleapis.com/fcm/send/${name}`;
    const sub = {
      endpoint,
      options: { applicationServerKey: Uint8Array.from(bytes).buffer },
      unsubscribe: vi.fn(async () => {
        if (current === sub) current = null;
        return true;
      }),
      toJSON: () => ({ endpoint, expirationTime: null, keys: { p256dh: "p".repeat(87), auth: "a".repeat(22) } }),
    };
    return sub;
  };
  if (existingKey) current = makeSub(Buffer.from(existingKey, "base64url"), "old");
  const pushManager = {
    getSubscription: vi.fn(async () => current),
    subscribe: vi.fn(async ({ applicationServerKey }) => {
      current = makeSub(applicationServerKey, `fresh-${++seq}`);
      return current;
    }),
  };
  const reg = { pushManager, active: {}, scope: "https://app.example/" };
  return {
    pushManager,
    get current() {
      return current;
    },
    container: {
      register: vi.fn(async () => reg),
      ready: Promise.resolve(reg),
      getRegistration: vi.fn(async () => reg),
      addEventListener: (type, fn) => listeners.add(fn),
      removeEventListener: (type, fn) => listeners.delete(fn),
    },
    emit: (data) => listeners.forEach((fn) => fn({ data })),
  };
}

function install({ permission = "granted", existingKey = null, ua = "Mozilla/5.0 (Linux; Android 14) Chrome/130.0.0.0 Mobile" } = {}) {
  browser = fakeBrowser({ existingKey });
  store = new Map();
  const NotificationStub = { permission, requestPermission: vi.fn(async () => permission) };
  vi.stubGlobal("window", {
    isSecureContext: true,
    PushManager: function PushManager() {},
    Notification: NotificationStub,
    atob: (s) => Buffer.from(s, "base64").toString("binary"),
    matchMedia: (q) => ({ matches: q === "(display-mode: standalone)" }),
  });
  vi.stubGlobal("Notification", NotificationStub);
  vi.stubGlobal("navigator", { userAgent: ua, serviceWorker: browser.container, maxTouchPoints: 5 });
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
    if (url === "/api/push/key") return { data: { publicKey: CURRENT_KEY, configured: true, problem: null } };
    if (url === "/api/push/devices") return { data: { devices: [] } };
    throw new Error(`unexpected GET ${url}`);
  });
  http.post.mockResolvedValue({ data: { ok: true, devices: 1 } });
  return import("../push.js");
}

const subscribeCalls = () => http.post.mock.calls.filter(([url]) => url === "/api/push/subscribe");
const refused = (status, data) => Object.assign(new Error(`Request failed with status code ${status}`), { response: { status, data } });

beforeEach(() => install());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("LW-150 — this device keeps a subscription the server can reach, and a test says what happened", () => {
  it("compares the key a subscription was made with against the server's key", async () => {
    const push = await load();
    const sub = { options: { applicationServerKey: Uint8Array.from(Buffer.from(OLD_KEY, "base64url")).buffer } };
    expect(push.subscriptionKeyMatches(sub, OLD_KEY)).toBe(true);
    expect(push.subscriptionKeyMatches(sub, CURRENT_KEY)).toBe(false);
    expect(push.subscriptionKeyMatches({ options: {} }, CURRENT_KEY)).toBe(null);
  });

  it("renews, on load, a subscription made with a different server key and tells the server which one it replaces", async () => {
    install({ existingKey: OLD_KEY });
    const push = await load();
    const out = await push.syncPush({ force: true });
    expect(out).toMatchObject({ ok: true, renewed: true });
    expect(browser.pushManager.subscribe).toHaveBeenCalledTimes(1);
    const used = browser.pushManager.subscribe.mock.calls[0][0].applicationServerKey;
    expect(toB64Url(used)).toBe(CURRENT_KEY);
    const [, body] = subscribeCalls()[0];
    expect(body.subscription.endpoint).toBe(browser.current.endpoint);
    expect(body.replaces).toBe("https://fcm.googleapis.com/fcm/send/old");
  });

  it("does not reuse an old-key subscription when notifications are enabled by hand", async () => {
    install({ existingKey: OLD_KEY });
    const push = await load();
    const out = await push.enablePush();
    expect(out.ok).toBe(true);
    expect(browser.pushManager.subscribe).toHaveBeenCalledTimes(1);
    expect(toB64Url(browser.pushManager.subscribe.mock.calls[0][0].applicationServerKey)).toBe(CURRENT_KEY);
  });

  it("keeps a subscription that already uses the server's key", async () => {
    install({ existingKey: CURRENT_KEY });
    const push = await load();
    const out = await push.syncPush({ force: true });
    expect(out).toMatchObject({ ok: true, renewed: false, endpoint: "https://fcm.googleapis.com/fcm/send/old" });
    expect(browser.pushManager.subscribe).not.toHaveBeenCalled();
  });

  it("treats the server as not configured when it says so, even if it once advertised a key", async () => {
    const push = await load();
    http.get.mockImplementation(async (url) => {
      if (url === "/api/push/key") return { data: { publicKey: null, configured: false, problem: "VAPID_PRIVATE_KEY is not set" } };
      return { data: { devices: [] } };
    });
    const state = await push.getPushState();
    expect(state).toMatchObject({ configured: false, problem: "VAPID_PRIVATE_KEY is not set" });
    const enabled = await push.enablePush();
    expect(enabled).toMatchObject({ ok: false, reason: "not-configured", detail: "VAPID_PRIVATE_KEY is not set" });
    expect(browser.pushManager.subscribe).not.toHaveBeenCalled();
  });

  it("reports whether the server holds this device, not only whether the browser has a subscription", async () => {
    install({ existingKey: CURRENT_KEY });
    const push = await load();
    const state = await push.getPushState();
    expect(state).toMatchObject({ subscribed: true, registered: false, deviceCount: 0, keyMatches: true });
    expect(state.device).toMatchObject({ android: true, installed: true });
  });

  it("returns the server's per-device report when nothing was delivered, instead of throwing it away", async () => {
    const push = await load();
    http.post.mockImplementation(async (url) => {
      if (url === "/api/push/test") throw refused(404, { code: "no_devices", devices: 0, delivered: 0, error: "No device is registered" });
      return { data: { ok: true } };
    });
    const report = await push.sendTestNotification("https://fcm.googleapis.com/fcm/send/x");
    expect(report).toMatchObject({ ok: false, code: "no_devices", devices: 0, httpStatus: 404 });
    expect(http.post).toHaveBeenCalledWith("/api/push/test", { endpoint: "https://fcm.googleapis.com/fcm/send/x" });
  });

  it("renews this device when the push service refused it, sends again, and waits for the device to show it", async () => {
    install({ existingKey: CURRENT_KEY });
    const push = await load();
    const tests = [];
    http.post.mockImplementation(async (url, body) => {
      if (url !== "/api/push/test") return { data: { ok: true, devices: 1 } };
      tests.push(body);
      if (tests.length === 1) {
        throw refused(502, {
          code: "all_refused",
          testId: "1111111111111111",
          devices: 1,
          delivered: 0,
          thisDevice: { registered: true, delivered: false, status: 403, removed: true, renew: true },
        });
      }
      return { data: { ok: true, testId: "2222222222222222", devices: 1, delivered: 1, thisDevice: { registered: true, delivered: true, status: 201 } } };
    });

    const run = await push.runPushTest({ waitMs: 2000 });

    expect(tests[0].endpoint).toBe("https://fcm.googleapis.com/fcm/send/old");
    expect(tests[1].endpoint).toBe(browser.current.endpoint);
    expect(tests[1].endpoint).not.toBe(tests[0].endpoint);
    expect(run.renewed).toMatchObject({ ok: true });
    expect(run.report).toMatchObject({ ok: true, delivered: 1 });
    const renewal = subscribeCalls().at(-1)[1];
    expect(renewal.replaces).toBe("https://fcm.googleapis.com/fcm/send/old");

    browser.emit({ type: "push", payload: { type: "test", testId: "1111111111111111" }, shown: true, at: 1 });
    browser.emit({ type: "push", payload: { type: "test", testId: "2222222222222222" }, shown: true, at: 2 });
    await expect(run.receipt).resolves.toMatchObject({ received: true, shown: true, at: 2 });
  });

  it("says when the device received the test but could not show it", async () => {
    install({ existingKey: CURRENT_KEY });
    const push = await load();
    http.post.mockImplementation(async (url) =>
      url === "/api/push/test"
        ? { data: { ok: true, testId: "3333333333333333", devices: 1, delivered: 1, thisDevice: { registered: true, delivered: true } } }
        : { data: { ok: true } }
    );
    const run = await push.runPushTest({ waitMs: 2000 });
    browser.emit({ type: "push", payload: { type: "test", testId: "3333333333333333" }, shown: false, error: "notification permission is denied" });
    await expect(run.receipt).resolves.toMatchObject({ received: true, shown: false, error: "notification permission is denied" });
  });

  it("gives up waiting and says so when the device never receives it", async () => {
    install({ existingKey: CURRENT_KEY });
    const push = await load();
    http.post.mockImplementation(async (url) =>
      url === "/api/push/test"
        ? { data: { ok: true, testId: "4444444444444444", devices: 1, delivered: 1, thisDevice: { registered: true, delivered: true } } }
        : { data: { ok: true } }
    );
    const run = await push.runPushTest({ waitMs: 30 });
    await expect(run.receipt).resolves.toMatchObject({ received: false, waited: 30 });
  });
});

describe("LW-150 — the settings page words the result honestly", () => {
  it("never words a test that reached no device as a success", async () => {
    const { testSummary } = await import("../../features/settings/pushReport.js");
    expect(testSummary({ ok: false, code: "no_devices", devices: 0, delivered: 0, error: "No device is registered for notifications on this account, so nothing was sent." })).toMatch(/nothing was sent/);
    expect(testSummary({ ok: true, devices: 2, delivered: 1, refused: 1 })).toBe(
      "The push service accepted the test for 1 of 2 registered devices, and refused it for 1."
    );
  });

  it("points an installed Android app at the phone's own notification settings", async () => {
    const { blockedAdvice, receiptAdvice } = await import("../../features/settings/pushReport.js");
    const phone = { android: true, installed: true };
    expect(blockedAdvice(phone)).toMatch(/Settings, then Apps, LedgerWatch, Notifications/);
    expect(blockedAdvice({ android: false, ios: false })).toBeNull();
    expect(receiptAdvice({ received: true, shown: true, at: 0 }, phone).advice).toMatch(/Pop on screen/);
    expect(receiptAdvice({ received: false, waited: 20000 }, phone).text).toMatch(/after 20 seconds/);
    expect(receiptAdvice({ received: false, waited: 20000 }, phone).advice).toMatch(/Unrestricted/);
  });
});
