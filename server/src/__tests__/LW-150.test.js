process.env.JWT_SECRET = process.env.JWT_SECRET || "lw-150-push-tests-only-0123456789abcdefghij";

const webpush = require("web-push");
const app = require("../app");
const User = require("../models/User");
const PushSubscription = require("../models/PushSubscription");
const signToken = require("../utils/token");
const push = require("../services/push.service");

const pairA = webpush.generateVAPIDKeys();
const pairB = webpush.generateVAPIDKeys();

const FCM_VAPID_403 =
  "the VAPID credentials in the authorization header do not correspond to the credentials used to create the subscriptions.";

let server;
let base;
let seq = 0;
let sendSpy;

const keys = { p256dh: "B".repeat(87), auth: "A".repeat(22) };
const endpoint = (name) => `https://fcm.googleapis.com/fcm/send/${name}-${seq}`;
const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
const WINDOWS_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

function refusal(status, body) {
  return new webpush.WebPushError("Received unexpected response code", status, {}, body, "https://fcm.googleapis.com/fcm/send/x");
}

function useKeys(pub, priv, subject = "mailto:ops@business.ng") {
  process.env.VAPID_PUBLIC_KEY = pub;
  process.env.VAPID_PRIVATE_KEY = priv;
  process.env.VAPID_SUBJECT = subject;
}

beforeAll(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  seq += 1;
  useKeys(pairA.publicKey, pairA.privateKey);
  sendSpy = vi.spyOn(webpush, "sendNotification").mockResolvedValue({ statusCode: 201 });
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function anAccount() {
  const user = await User.create({ name: "Ada", email: `lw150-${Date.now()}-${seq}@business.ng`, passwordHash: "x" });
  return { user, token: signToken(user._id, 0) };
}

async function call(method, path, { token, body } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function addDevice(user, name, userAgent) {
  return PushSubscription.create({ userId: user._id, endpoint: endpoint(name), keys, userAgent });
}

describe("LW-150 — a test notification says what happened on every device", () => {
  it("names the phone the push service refused, even when another device took it", async () => {
    const { user, token } = await anAccount();
    await addDevice(user, "phone", ANDROID_UA);
    await addDevice(user, "laptop", WINDOWS_UA);
    sendSpy.mockImplementation(async (sub) => {
      if (sub.endpoint === endpoint("phone")) throw refusal(403, FCM_VAPID_403);
      return { statusCode: 201 };
    });

    const res = await call("POST", "/api/push/test", { token, body: { endpoint: endpoint("phone") } });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ devices: 2, delivered: 1, refused: 1, removed: 1 });
    expect(res.body.thisDevice).toMatchObject({ registered: true, delivered: false, status: 403, removed: true, renew: true });
    expect(res.body.thisDevice.device).toBe("Chrome on Android");
    expect(res.body.thisDevice.reason).toMatch(/different server key/i);
    const laptop = res.body.results.find((r) => r.device === "Chrome on Windows");
    expect(laptop).toMatchObject({ delivered: true, status: 201, thisDevice: false });
    expect(await PushSubscription.exists({ endpoint: endpoint("phone") })).toBeNull();
    expect(await PushSubscription.exists({ endpoint: endpoint("laptop") })).not.toBeNull();
  });

  it("does not answer success when every device was refused, and does not claim there are none", async () => {
    const { user, token } = await anAccount();
    await addDevice(user, "only", ANDROID_UA);
    sendSpy.mockRejectedValue(refusal(403, FCM_VAPID_403));

    const res = await call("POST", "/api/push/test", { token, body: { endpoint: endpoint("only") } });

    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ code: "all_refused", devices: 1, delivered: 0, refused: 1 });
    expect(res.body.error).not.toMatch(/no push subscriptions/i);
    expect(res.body.error).toMatch(/refused/i);
  });

  it("says plainly that no device is registered, and whether this one is", async () => {
    const { token } = await anAccount();
    const res = await call("POST", "/api/push/test", { token, body: { endpoint: endpoint("ghost") } });
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: "no_devices", devices: 0, delivered: 0 });
    expect(res.body.thisDevice).toMatchObject({ registered: false });
  });

  it("reports this device as not registered when only other devices are", async () => {
    const { user, token } = await anAccount();
    await addDevice(user, "laptop", WINDOWS_UA);
    const res = await call("POST", "/api/push/test", { token, body: { endpoint: endpoint("phone") } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ devices: 1, delivered: 1 });
    expect(res.body.thisDevice).toMatchObject({ registered: false, delivered: false });
  });

  it("removes gone subscriptions, keeps ones refused for a passing reason, and gives each a plain reason", async () => {
    const { user, token } = await anAccount();
    await addDevice(user, "gone", ANDROID_UA);
    await addDevice(user, "busy", WINDOWS_UA);
    await addDevice(user, "broken", WINDOWS_UA);
    sendSpy.mockImplementation(async (sub) => {
      if (sub.endpoint === endpoint("gone")) throw refusal(410, "push subscription has unsubscribed or expired.");
      if (sub.endpoint === endpoint("busy")) throw refusal(429, "Too many requests");
      throw refusal(503, "Service unavailable");
    });

    const res = await call("POST", "/api/push/test", { token, body: {} });

    expect(res.status).toBe(502);
    const byStatus = Object.fromEntries(res.body.results.map((r) => [r.status, r]));
    expect(byStatus[410]).toMatchObject({ delivered: false, removed: true });
    expect(byStatus[410].reason).toMatch(/no longer exists/i);
    expect(byStatus[429]).toMatchObject({ delivered: false, removed: false });
    expect(byStatus[429].reason).toMatch(/too many|rate/i);
    expect(byStatus[503]).toMatchObject({ delivered: false, removed: false });
    expect(await PushSubscription.countDocuments({ userId: user._id })).toBe(2);
  });

  it("drops a subscription made with another server key on an ordinary notification too", async () => {
    const { user } = await anAccount();
    await addDevice(user, "stale", ANDROID_UA);
    sendSpy.mockRejectedValue(refusal(403, FCM_VAPID_403));
    const out = await push.notifyUser(user._id, { title: "Money arrived", tag: "pay-1" });
    expect(out).toMatchObject({ sent: 0, pruned: 1, devices: 1 });
    expect(await PushSubscription.exists({ endpoint: endpoint("stale") })).toBeNull();
  });

  it("refuses a public and private key that do not belong together, instead of signing every push wrongly", async () => {
    const { user, token } = await anAccount();
    await addDevice(user, "phone", ANDROID_UA);
    useKeys(pairA.publicKey, pairB.privateKey);

    const key = await call("GET", "/api/push/key", { token });
    expect(key.status).toBe(200);
    expect(key.body).toMatchObject({ configured: false, publicKey: null });
    expect(key.body.problem).toMatch(/do not belong together/i);

    const res = await call("POST", "/api/push/test", { token, body: {} });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/do not belong together/i);
    expect(sendSpy).not.toHaveBeenCalled();
    expect(await PushSubscription.exists({ endpoint: endpoint("phone") })).not.toBeNull();
  });

  it("does not advertise a key the server cannot sign with", async () => {
    const { token } = await anAccount();
    useKeys(pairA.publicKey, "");
    const key = await call("GET", "/api/push/key", { token });
    expect(key.body).toMatchObject({ configured: false, publicKey: null });
    expect(key.body.problem).toMatch(/VAPID_PRIVATE_KEY/);
    const anon = await call("GET", "/api/push/vapid");
    expect(anon.body).toMatchObject({ configured: false, publicKey: null });
    expect(anon.body.problem).toBeUndefined();
  });

  it("accepts keys pasted with spaces and a subject without mailto, and picks up a change without a restart", async () => {
    const { user, token } = await anAccount();
    await addDevice(user, "phone", ANDROID_UA);
    useKeys(` ${pairB.publicKey}\n`, `${pairB.privateKey} `, "ops@business.ng");

    const key = await call("GET", "/api/push/key", { token });
    expect(key.body).toMatchObject({ configured: true, publicKey: pairB.publicKey });

    const res = await call("POST", "/api/push/test", { token, body: { endpoint: endpoint("phone") } });
    expect(res.status).toBe(200);
    expect(res.body.thisDevice).toMatchObject({ delivered: true });
    const options = sendSpy.mock.calls[0][2];
    expect(options).toMatchObject({ TTL: expect.any(Number), urgency: "high", topic: "test" });
    expect(options.vapidDetails).toEqual({ subject: "mailto:ops@business.ng", publicKey: pairB.publicKey, privateKey: pairB.privateKey });
  });

  it("sends the test with an id the device can report back, and the payload the service worker reads", async () => {
    const { user, token } = await anAccount();
    await addDevice(user, "phone", ANDROID_UA);
    const res = await call("POST", "/api/push/test", { token, body: { endpoint: endpoint("phone") } });
    expect(res.status).toBe(200);
    expect(res.body.testId).toMatch(/^[0-9a-f]{16}$/);
    const payload = JSON.parse(sendSpy.mock.calls[0][1]);
    expect(payload).toMatchObject({ type: "test", tag: "test", url: "/app/settings?section=notifications", testId: res.body.testId });
    expect(payload.title).toBeTruthy();
    expect(payload.body).toBeTruthy();
  });

  it("refuses a test body field it does not know rather than passing it on", async () => {
    const { token } = await anAccount();
    const res = await call("POST", "/api/push/test", { token, body: { endpoint: 42 } });
    expect(res.status).toBe(400);
  });
});
