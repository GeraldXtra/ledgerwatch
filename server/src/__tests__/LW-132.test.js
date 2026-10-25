process.env.JWT_SECRET = process.env.JWT_SECRET || "lw-mode-tests-only-0123456789abcdefghij";
const axios = require("axios");
const mongoose = require("mongoose");
const webpush = require("web-push");

const vapid = webpush.generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = vapid.publicKey;
process.env.VAPID_PRIVATE_KEY = vapid.privateKey;
process.env.VAPID_SUBJECT = "mailto:test@example.com";

const User = require("../models/User");
const Watch = require("../models/Watch");
const Alert = require("../models/Alert");
const PushSubscription = require("../models/PushSubscription");
const cg = require("../services/coingecko.service");
const { runPricePass } = require("../services/market.service");
const watches = require("../controllers/watches.controller");
const alerts = require("../controllers/alerts.controller");
const portfolio = require("../controllers/portfolio.controller");

let seq = 0;
let pushes;

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
  return User.create({ name: "Mode", email: `mode-${Date.now()}-${++seq}@example.com`, passwordHash: "x", ...extra });
}

function aWatch(user, mode, extra = {}) {
  return Watch.create({ userId: user._id, coinId: "bitcoin", symbol: "BTC", mode, condition: { type: "price_above", value: 1 }, active: true, ...extra });
}

function anAlert(user, mode) {
  return Alert.create({ userId: user._id, watchId: new mongoose.Types.ObjectId(), coinId: "bitcoin", symbol: "BTC", message: "m", suggestion: "buy", mode, status: "pending" });
}

async function call(handler, req) {
  const res = mockRes();
  await handler(req, res);
  return res;
}

beforeEach(() => {
  pushes = [];
  vi.spyOn(webpush, "sendNotification").mockImplementation(async (sub, body) => {
    pushes.push(JSON.parse(body));
    return { statusCode: 201 };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("LW-132 — paper and live never show each other's watches and alerts", () => {
  it("shows the mode the page asks for, even while the account is set to the other one", async () => {
    const user = await aUser({ tradingMode: "paper" });
    await aWatch(user, "paper");
    await aWatch(user, "live", { coinId: "ethereum", symbol: "ETH" });
    await anAlert(user, "paper");
    await anAlert(user, "live");

    const live = await call(watches.list, { user, query: { mode: "live" } });
    expect(live.body.mode).toBe("live");
    expect(live.body.watches.map((w) => w.mode)).toEqual(["live"]);

    const liveAlerts = await call(alerts.list, { user, query: { mode: "live" } });
    expect(liveAlerts.body.alerts.every((a) => a.mode === "live")).toBe(true);
    expect(liveAlerts.body.alerts).toHaveLength(1);

    const paper = await call(watches.list, { user, query: { mode: "paper" } });
    expect(paper.body.watches.map((w) => w.mode)).toEqual(["paper"]);
  });

  it("falls back to the account's mode when the page does not say, and ignores anything else", async () => {
    const user = await aUser({ tradingMode: "live" });
    await aWatch(user, "paper");
    await aWatch(user, "live");
    expect((await call(watches.list, { user, query: {} })).body.mode).toBe("live");
    expect((await call(watches.list, { user, query: { mode: "everything" } })).body.watches.every((w) => w.mode === "live")).toBe(true);
  });

  it("keeps the portfolio and the alert history in their own mode too", async () => {
    const user = await aUser({ tradingMode: "paper" });
    expect((await call(portfolio.get, { user, query: { mode: "live" } })).body).toMatchObject({ mode: "live", portfolio: { mode: "live" } });
    expect((await call(alerts.history, { user, query: { mode: "live" } })).body.mode).toBe("live");
  });

  it("creates a watch in the mode the page is showing", async () => {
    const user = await aUser({ tradingMode: "paper" });
    vi.spyOn(axios, "get").mockResolvedValue({ data: [] });
    const res = await call(watches.create, { user, body: { coinId: "bitcoin", symbol: "BTC", type: "price_above", value: 1, mode: "live" } });
    expect(res.statusCode).toBe(201);
    expect(res.body.watch.mode).toBe("live");
  });

  it("will not create a live watch for the shared demo account", async () => {
    const demo = await aUser({ email: "demo@ledgerwatch.app" });
    const res = await call(watches.create, { user: demo, body: { coinId: "bitcoin", symbol: "BTC", type: "price_above", value: 1, mode: "live" } });
    expect(res.statusCode).toBe(403);
  });
});

describe("LW-132 — an alert from the other mode is kept but sends no notification", () => {
  async function trigger(accountMode, watchMode) {
    const user = await aUser({ tradingMode: accountMode });
    await PushSubscription.create({ userId: user._id, endpoint: `https://fcm.googleapis.com/fcm/send/mode-${seq}`, keys: { p256dh: "B".repeat(87), auth: "A".repeat(22) } });
    await aWatch(user, watchMode);
    cg._resetForTests();
    vi.spyOn(axios, "get").mockResolvedValue({ data: [{ id: "bitcoin", symbol: "btc", name: "Bitcoin", current_price: 100 }] });
    const out = await runPricePass({ userId: user._id });
    return { user, out };
  }

  it("notifies for a live alert while the account is live", async () => {
    const { user, out } = await trigger("live", "live");
    expect(out.alertsCreated).toBe(1);
    await vi.waitFor(() => expect(pushes).toHaveLength(1));
    expect(await Alert.countDocuments({ userId: user._id, mode: "live" })).toBe(1);
  });

  it("keeps a paper alert silent while the account is live, and still records it", async () => {
    const { user, out } = await trigger("live", "paper");
    expect(out.alertsCreated).toBe(1);
    await new Promise((r) => setTimeout(r, 50));
    expect(pushes).toHaveLength(0);
    expect(await Alert.countDocuments({ userId: user._id, mode: "paper", status: "pending" })).toBe(1);
  });
});
