const jwt = require("jsonwebtoken");
const webpush = require("web-push");

const vapid = webpush.generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = vapid.publicKey;
process.env.VAPID_PRIVATE_KEY = vapid.privateKey;
process.env.VAPID_SUBJECT = "mailto:test@example.com";

const User = require("../models/User");
const RampOrder = require("../models/RampOrder");
const PushSubscription = require("../models/PushSubscription");
const notifyService = require("../services/notify.service");
const ramp = require("../services/ramp.service");
const controller = require("../controllers/ramp.controller");

const ACCESS = "partner-access-token-for-tests-0123456789";
let calls;
let pushes;
let seq = 0;

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

function transak({ widgetUrl = "https://global.transak.com/?apiKey=pk&sessionId=abc" } = {}) {
  calls = [];
  vi.stubGlobal("fetch", async (url, init) => {
    calls.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) });
    if (String(url).includes("refresh-token")) {
      return { ok: true, status: 200, json: async () => ({ data: { accessToken: ACCESS, expiresAt: Math.floor(Date.now() / 1000) + 7 * 86400 } }) };
    }
    return { ok: true, status: 200, json: async () => ({ data: { widgetUrl } }) };
  });
}

async function aUser(extra = {}) {
  const user = await User.create({ name: "Buyer", email: `ramp-${Date.now()}-${++seq}@example.com`, passwordHash: "x", emailVerified: true, ...extra });
  await PushSubscription.create({ userId: user._id, endpoint: `https://fcm.googleapis.com/fcm/send/ramp-${seq}`, keys: { p256dh: "B".repeat(87), auth: "A".repeat(22) } });
  return user;
}

beforeEach(() => {
  ramp._resetForTests();
  process.env.TRANSAK_API_KEY = "pk_test_key";
  process.env.TRANSAK_API_SECRET = "sk_test_secret";
  process.env.TRANSAK_ENV = "staging";
  process.env.CLIENT_URL = "https://www.useledgerwatch.co";
  pushes = [];
  vi.spyOn(webpush, "sendNotification").mockImplementation(async (sub, body) => {
    pushes.push(JSON.parse(body));
    return { statusCode: 201 };
  });
  vi.spyOn(notifyService, "sendEmail").mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete process.env.TRANSAK_API_KEY;
  delete process.env.TRANSAK_API_SECRET;
  delete process.env.TRANSAK_ENV;
});

describe("buying and selling with naira", () => {
  it("says plainly that it is switched off when no provider account is set", async () => {
    delete process.env.TRANSAK_API_KEY;
    expect(ramp.rampStatus()).toMatchObject({ configured: false, fiat: "NGN" });
    const res = mockRes();
    await controller.session({ user: await aUser(), body: { mode: "BUY" } }, res);
    expect(res.statusCode).toBe(400);
  });

  it("opens a one-time payment page in naira from the server, keeping the secret off the browser", async () => {
    transak();
    const user = await aUser();
    const res = mockRes();
    await controller.session({ user, body: { mode: "BUY", cryptoCurrencyCode: "usdt", fiatAmount: "50000" } }, res);
    expect(res.statusCode).toBe(201);
    expect(res.body.widgetUrl).toMatch(/^https:\/\/global\.transak\.com\//);
    expect(JSON.stringify(res.body)).not.toContain("sk_test_secret");

    const [refresh, session] = calls;
    expect(refresh.url).toBe("https://api-stg.transak.com/partners/api/v2/refresh-token");
    expect(refresh.headers).toMatchObject({ "x-api-key": "pk_test_key", "api-secret": "sk_test_secret" });
    expect(session.url).toBe("https://api-gateway-stg.transak.com/api/v2/auth/session");
    expect(session.headers["access-token"]).toBe(ACCESS);
    expect(session.body.widgetParams).toMatchObject({
      apiKey: "pk_test_key",
      referrerDomain: "www.useledgerwatch.co",
      productsAvailed: "BUY",
      fiatCurrency: "NGN",
      cryptoCurrencyCode: "USDT",
      fiatAmount: 50000,
      partnerCustomerId: String(user._id),
    });
    expect(await RampOrder.exists({ partnerOrderId: res.body.partnerOrderId, userId: user._id })).not.toBeNull();
  });

  it("reuses the access token instead of asking for a new one each time", async () => {
    transak();
    const user = await aUser();
    await controller.session({ user, body: { mode: "SELL" } }, mockRes());
    await controller.session({ user, body: { mode: "BUY" } }, mockRes());
    expect(calls.filter((c) => c.url.includes("refresh-token"))).toHaveLength(1);
  });

  it("refuses a page address that is not the provider's", async () => {
    transak({ widgetUrl: "https://evil.example/transak.com" });
    const res = mockRes();
    await controller.session({ user: await aUser(), body: { mode: "BUY" } }, res);
    expect(res.statusCode).toBe(502);
  });

  it("refuses coins, modes and amounts it does not offer", async () => {
    transak();
    const user = await aUser();
    for (const body of [{ mode: "SWAP" }, { mode: "BUY", cryptoCurrencyCode: "SHIB" }, { mode: "BUY", fiatAmount: "-5" }]) {
      const res = mockRes();
      await controller.session({ user, body }, res);
      expect(res.statusCode).toBe(400);
    }
    expect(calls).toHaveLength(0);
  });
});

describe("order updates from the provider", () => {
  async function opened(user) {
    transak();
    const res = mockRes();
    await controller.session({ user, body: { mode: "BUY", cryptoCurrencyCode: "USDT" } }, res);
    return res.body.partnerOrderId;
  }

  async function deliver(payload, secret = ACCESS) {
    const res = mockRes();
    await controller.webhook({ body: { data: jwt.sign(payload, secret) }, ip: "203.0.113.5" }, res);
    return res;
  }

  it("records a completed purchase and tells the buyer once, however often the provider repeats it", async () => {
    const user = await aUser();
    const ref = await opened(user);
    const payload = {
      eventID: "ORDER_COMPLETED",
      webhookData: { id: "order-1", status: "COMPLETED", partnerOrderId: ref, isBuyOrSell: "BUY", cryptoCurrency: "USDT", cryptoAmount: "31.2", fiatAmount: "50000", fiatCurrency: "NGN", network: "tron" },
    };
    expect((await deliver(payload)).body).toMatchObject({ ok: true, matched: true });
    await deliver(payload);
    await vi.waitFor(() => expect(pushes).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(pushes).toHaveLength(1);
    expect(pushes[0]).toMatchObject({ title: "Bought 31.2 USDT", type: "moneyIn" });
    const order = await RampOrder.findOne({ partnerOrderId: ref }).lean();
    expect(order).toMatchObject({ providerOrderId: "order-1", outcome: "completed", status: "COMPLETED" });
  });

  it("tells the seller when an order fails", async () => {
    const user = await aUser();
    await opened(user);
    await deliver({ eventID: "ORDER_FAILED", webhookData: { id: "order-2", status: "FAILED", partnerCustomerId: String(user._id), isBuyOrSell: "SELL", cryptoCurrency: "USDT" } });
    await vi.waitFor(() => expect(pushes).toHaveLength(1));
    expect(pushes[0].title).toBe("Your sale did not go through");
  });

  it("finds the account by its wallet address when the provider sends no reference", async () => {
    const user = await aUser({ walletAddress: "0x1111111111111111111111111111111111111111" });
    await opened(user);
    const res = await deliver({ eventID: "ORDER_COMPLETED", webhookData: { id: "order-3", status: "COMPLETED", walletAddress: "0x1111111111111111111111111111111111111111", cryptoCurrency: "ETH" } });
    expect(res.body.matched).toBe(true);
    expect((await RampOrder.findOne({ providerOrderId: "order-3" }).lean()).matchedBy).toBe("walletAddress");
  });

  it("stores an order it cannot place without telling anyone about it", async () => {
    await opened(await aUser());
    const res = await deliver({ eventID: "ORDER_COMPLETED", webhookData: { id: "order-4", status: "COMPLETED", walletAddress: "0x9999999999999999999999999999999999999999" } });
    expect(res.body).toMatchObject({ ok: true, matched: false });
    await new Promise((r) => setTimeout(r, 50));
    expect(pushes).toHaveLength(0);
  });

  it("refuses an update that was not signed with the partner token", async () => {
    const user = await aUser();
    const ref = await opened(user);
    const res = await deliver({ eventID: "ORDER_COMPLETED", webhookData: { id: "x", status: "COMPLETED", partnerOrderId: ref } }, "not-the-token");
    expect(res.statusCode).toBe(401);
    expect(await RampOrder.exists({ providerOrderId: "x" })).toBeNull();
  });

  it("reads each provider status as the right outcome", () => {
    expect(ramp.outcomeOf("COMPLETED")).toBe("completed");
    expect(ramp.outcomeOf("ON_HOLD_PENDING_DELIVERY_FROM_TRANSAK")).toBe("on-hold");
    for (const s of ["FAILED", "EXPIRED", "CANCELLED", "REFUNDED"]) expect(ramp.outcomeOf(s)).toBe("failed");
    for (const s of ["AWAITING_PAYMENT_FROM_USER", "PROCESSING", "PENDING_DELIVERY_FROM_TRANSAK"]) expect(ramp.outcomeOf(s)).toBe("in-progress");
  });
});
