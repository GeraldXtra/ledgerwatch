process.env.JWT_SECRET = process.env.JWT_SECRET || "lw-161-app-push-tests-0123456789abcdefghij";

const webpush = require("web-push");
const app = require("../app");
const User = require("../models/User");
const NativeDevice = require("../models/NativeDevice");
const PushSubscription = require("../models/PushSubscription");
const signToken = require("../utils/token");
const fcm = require("../services/fcm.service");
const push = require("../services/push.service");
const { scopedRepo, TENANT_MODELS } = require("../repositories/scoped");

const pair = webpush.generateVAPIDKeys();

const ACCOUNT = {
  type: "service_account",
  project_id: "ledgerwatch-test",
  private_key_id: "k1",
  private_key: "-----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----\n",
  client_email: "fcm@ledgerwatch-test.iam.gserviceaccount.com",
  client_id: "1",
};

let server;
let base;
let seq = 0;
let sent;

beforeAll(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
  await NativeDevice.init();
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  seq += 1;
  sent = [];
  process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify(ACCOUNT);
  process.env.VAPID_PUBLIC_KEY = pair.publicKey;
  process.env.VAPID_PRIVATE_KEY = pair.privateKey;
  fcm._resetForTests();
  fcm._setSenderForTests(async (message) => {
    sent.push(message);
    return `projects/ledgerwatch-test/messages/${sent.length}`;
  });
  vi.spyOn(webpush, "sendNotification").mockResolvedValue({ statusCode: 201 });
});

afterEach(() => {
  vi.restoreAllMocks();
  fcm._resetForTests();
});

const token = (name) => `f${name}-${seq}:APA91b${"x".repeat(80)}`;

async function anAccount() {
  const user = await User.create({ name: "Ada", email: `lw161-${Date.now()}-${seq}@business.ng`, passwordHash: "x" });
  return { user, jwt: signToken(user._id, 0) };
}

async function call(method, path, { jwt, body, ua } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
      ...(ua ? { "User-Agent": ua } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

describe("LW-161 — the Android app registers with Firebase and gets every notification", () => {
  it("refuses to register a phone when the server has no Firebase key, and says what is missing", async () => {
    delete process.env.FIREBASE_SERVICE_ACCOUNT;
    const { jwt } = await anAccount();
    const res = await call("POST", "/api/push/native", { jwt, body: { platform: "android", token: token("a") } });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/FIREBASE_SERVICE_ACCOUNT/);
    const key = await call("GET", "/api/push/key", { jwt });
    expect(key.body.native).toMatchObject({ configured: false });
  });

  it("tells the phone's config from the server's key", () => {
    process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ project_info: { project_id: "x" }, client: [{ client_info: { mobilesdk_app_id: "1" } }] });
    fcm._resetForTests();
    expect(fcm.fcmStatus().problem).toMatch(/google-services\.json is a different file/);
    process.env.FIREBASE_SERVICE_ACCOUNT = Buffer.from(JSON.stringify(ACCOUNT)).toString("base64");
    fcm._resetForTests();
    expect(fcm.fcmStatus()).toMatchObject({ configured: true, projectId: "ledgerwatch-test" });
  });

  it("registers a phone, lists it as a device, and sends it the test with the app's own icon and channel", async () => {
    const { jwt } = await anAccount();
    const reg = await call("POST", "/api/push/native", { jwt, body: { platform: "android", token: token("phone") }, ua: "LedgerWatchApp/1.0.0" });
    expect(reg.status).toBe(201);
    expect(reg.body.devices).toBe(1);

    const list = await call("GET", "/api/push/devices", { jwt });
    expect(list.body.devices).toEqual([expect.objectContaining({ kind: "app", platform: "android", token: token("phone") })]);

    const res = await call("POST", "/api/push/test", { jwt, body: { token: token("phone") } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ devices: 1, delivered: 1, refused: 0 });
    expect(res.body.thisDevice).toMatchObject({ registered: true, delivered: true, device: "LedgerWatch app on Android" });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      token: token("phone"),
      notification: { title: "LedgerWatch test notification" },
      data: { type: "test", testId: res.body.testId, url: "/app/settings?section=notifications" },
      android: { priority: "high", notification: { icon: "ic_stat_ledgerwatch", color: "#FF9900", channelId: "ledgerwatch", tag: "test" } },
    });
    expect(Object.values(sent[0].data).every((v) => typeof v === "string")).toBe(true);
  });

  it("sends an ordinary notification to the phone and the browser together, and prunes a phone Firebase no longer knows", async () => {
    const { user } = await anAccount();
    await NativeDevice.create({ userId: user._id, token: token("gone"), platform: "android" });
    await NativeDevice.create({ userId: user._id, token: token("ok"), platform: "android" });
    await PushSubscription.create({ userId: user._id, endpoint: `https://fcm.googleapis.com/fcm/send/b-${seq}`, keys: { p256dh: "B".repeat(87), auth: "A".repeat(22) } });
    fcm._setSenderForTests(async (message) => {
      if (message.token === token("gone")) {
        const err = new Error("Requested entity was not found.");
        err.code = "messaging/registration-token-not-registered";
        throw err;
      }
      sent.push(message);
      return "id";
    });

    const out = await push.notifyUser(user._id, { title: "Money arrived", body: "20 USDC", tag: "pay-1", url: "/app/wallet" });
    expect(out).toMatchObject({ devices: 3, sent: 2, pruned: 1 });
    expect(await NativeDevice.exists({ token: token("gone") })).toBeNull();
    expect(await NativeDevice.exists({ token: token("ok") })).not.toBeNull();
    const phone = out.results.find((r) => r.host === "fcm.googleapis.com" && !r.delivered);
    expect(phone.reason).toMatch(/no longer valid/);
  });

  it("still reaches the phone when the browser keys are missing", async () => {
    process.env.VAPID_PRIVATE_KEY = "";
    const { user, jwt } = await anAccount();
    await NativeDevice.create({ userId: user._id, token: token("only"), platform: "android" });
    const res = await call("POST", "/api/push/test", { jwt, body: { token: token("only") } });
    expect(res.status).toBe(200);
    expect(res.body.delivered).toBe(1);
  });

  it("moves a phone to the account that signs in on it, forgets it on request, and wipes it with the account", async () => {
    const a = await anAccount();
    const b = await anAccount();
    await call("POST", "/api/push/native", { jwt: a.jwt, body: { platform: "android", token: token("shared") } });
    await call("POST", "/api/push/native", { jwt: b.jwt, body: { platform: "android", token: token("shared") } });
    expect((await NativeDevice.find({ token: token("shared") })).map((d) => String(d.userId))).toEqual([String(b.user._id)]);

    const forget = await call("POST", "/api/push/native/forget", { jwt: b.jwt, body: { token: token("shared") } });
    expect(forget.body.ok).toBe(true);
    expect(await NativeDevice.exists({ token: token("shared") })).toBeNull();

    await call("POST", "/api/push/native", { jwt: a.jwt, body: { platform: "android", token: token("wiped") } });
    expect(Object.keys(TENANT_MODELS)).toContain("nativeDevices");
    const repo = scopedRepo(a.user._id);
    await Promise.all(Object.keys(TENANT_MODELS).map((name) => repo[name].deleteMany({})));
    expect(await NativeDevice.exists({ userId: a.user._id })).toBeNull();
  });

  it("refuses a token that is not a token", async () => {
    const { jwt } = await anAccount();
    for (const bad of ["short", "has spaces in it ".repeat(3), 7]) {
      const res = await call("POST", "/api/push/native", { jwt, body: { platform: "android", token: bad } });
      expect(res.status).toBe(400);
    }
  });
});
