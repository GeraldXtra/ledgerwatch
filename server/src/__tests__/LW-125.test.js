const mongoose = require("mongoose");
const webpush = require("web-push");
const User = require("../models/User");
const PushSubscription = require("../models/PushSubscription");

const vapid = webpush.generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = vapid.publicKey;
process.env.VAPID_PRIVATE_KEY = vapid.privateKey;
process.env.VAPID_SUBJECT = "mailto:test@example.com";

const push = require("../services/push.service");
const controller = require("../controllers/push.controller");

let seq = 0;
const anEmail = () => `lw125-${Date.now()}-${++seq}@example.com`;
const keys = { p256dh: "B".repeat(87), auth: "A".repeat(22) };
const endpoint = (n) => `https://fcm.googleapis.com/fcm/send/device-${n}-${seq}`;

function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = (c) => {
    res.statusCode = c;
    return res;
  };
  res.json = (b) => {
    res.body = b;
    return res;
  };
  return res;
}

async function aUser(extra = {}) {
  return User.create({ name: "Push", email: anEmail(), passwordHash: "x", ...extra });
}

async function subscribe(user, sub, extra = {}) {
  const res = mockRes();
  await controller.subscribe({ user, body: { subscription: sub, ...extra }, headers: { "user-agent": "test" } }, res);
  return res;
}

let sendSpy;
beforeEach(() => {
  sendSpy = vi.spyOn(webpush, "sendNotification").mockResolvedValue({ statusCode: 201 });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await PushSubscription.collection.dropIndex("endpoint_1").catch(() => {});
});

describe("LW-125 — notifications keep reaching every device", () => {
  it("sends with high urgency, a one day lifetime and a topic, so a sleeping phone still gets it", async () => {
    const user = await aUser();
    await PushSubscription.create({ userId: user._id, endpoint: endpoint(1), keys });
    const out = await push.notifyUser(user._id, { title: "t", body: "b", tag: "pay-123" });
    expect(out.sent).toBe(1);
    const options = sendSpy.mock.calls[0][2];
    expect(options).toMatchObject({ TTL: 86400, urgency: "high", topic: "pay-123" });
  });

  it("reaches every subscribed device of the account", async () => {
    const user = await aUser();
    await PushSubscription.create({ userId: user._id, endpoint: endpoint(2), keys });
    await PushSubscription.create({ userId: user._id, endpoint: endpoint(3), keys });
    const out = await push.notifyUser(user._id, { title: "t", body: "b" });
    expect(out.sent).toBe(2);
  });

  it("drops a subscription the push service says is gone, and keeps the others", async () => {
    const user = await aUser();
    await PushSubscription.create({ userId: user._id, endpoint: endpoint(4), keys });
    await PushSubscription.create({ userId: user._id, endpoint: endpoint(5), keys });
    sendSpy.mockImplementation(async (sub) => {
      if (sub.endpoint === endpoint(4)) throw Object.assign(new Error("gone"), { statusCode: 410 });
      return { statusCode: 201 };
    });
    const out = await push.notifyUser(user._id, { title: "t" });
    expect(out).toMatchObject({ sent: 1, pruned: 1 });
    expect(await PushSubscription.countDocuments({ userId: user._id })).toBe(1);
  });

  it("holds back a category the user switched off", async () => {
    const user = await aUser({ notifyPrefs: { trades: false } });
    await PushSubscription.create({ userId: user._id, endpoint: endpoint(6), keys });
    const out = await push.notifyUser(user._id, { title: "t" }, "trades");
    expect(out.skipped).toBe(true);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("moves a shared device to the account signed in now, even under the old global endpoint index", async () => {
    await PushSubscription.collection.createIndex({ endpoint: 1 }, { unique: true, name: "endpoint_1" });
    const first = await aUser();
    const second = await aUser();
    const sub = { endpoint: endpoint(7), keys };

    expect((await subscribe(first, sub)).statusCode).toBe(201);
    const res = await subscribe(second, sub);
    expect(res.statusCode).toBe(201);

    const rows = await PushSubscription.find({ endpoint: sub.endpoint }).lean();
    expect(rows).toHaveLength(1);
    expect(String(rows[0].userId)).toBe(String(second._id));
  });

  it("replaces the endpoint this device used before when it subscribes again", async () => {
    const user = await aUser();
    const old = { endpoint: endpoint(8), keys };
    const fresh = { endpoint: endpoint(9), keys };
    await subscribe(user, old);
    const res = await subscribe(user, fresh, { replaces: old.endpoint });
    expect(res.statusCode).toBe(201);
    expect(res.body.devices).toBe(1);
    expect(await PushSubscription.exists({ endpoint: old.endpoint })).toBeNull();
  });

  it("lets the service worker renew a rotated subscription for the same account", async () => {
    const user = await aUser();
    await PushSubscription.create({ userId: user._id, endpoint: endpoint(10), keys });
    const res = mockRes();
    await controller.resubscribe(
      { body: { oldEndpoint: endpoint(10), subscription: { endpoint: endpoint(11), keys } }, headers: {} },
      res
    );
    expect(res.statusCode).toBe(200);
    const row = await PushSubscription.findOne({ endpoint: endpoint(11) }).lean();
    expect(String(row.userId)).toBe(String(user._id));
    expect(await PushSubscription.exists({ endpoint: endpoint(10) })).toBeNull();
  });

  it("refuses to renew a subscription it never issued, or to a push service it does not know", async () => {
    const unknown = mockRes();
    await controller.resubscribe(
      { body: { oldEndpoint: "https://fcm.googleapis.com/fcm/send/never", subscription: { endpoint: endpoint(12), keys } }, headers: {} },
      unknown
    );
    expect(unknown.statusCode).toBe(404);

    const user = await aUser();
    await PushSubscription.create({ userId: user._id, endpoint: endpoint(13), keys });
    const evil = mockRes();
    await controller.resubscribe(
      { body: { oldEndpoint: endpoint(13), subscription: { endpoint: "https://evil.example/push", keys } }, headers: {} },
      evil
    );
    expect(evil.statusCode).toBe(400);
    expect(await PushSubscription.exists({ endpoint: endpoint(13) })).not.toBeNull();
  });

  it("lists the devices that will be notified", async () => {
    const user = await aUser();
    await subscribe(user, { endpoint: endpoint(14), keys });
    const res = mockRes();
    await controller.devices({ user }, res);
    expect(res.body.devices).toHaveLength(1);
    expect(res.body.devices[0]).toMatchObject({ endpoint: endpoint(14), userAgent: "test" });
    expect(res.body.devices[0].keys).toBeUndefined();
  });

  it("refuses a malformed id rather than throwing", async () => {
    const res = await subscribe(await aUser(), { endpoint: "not a url", keys });
    expect(res.statusCode).toBe(400);
    expect(mongoose.connection.readyState).toBe(1);
  });
});
