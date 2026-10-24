const axios = require("axios");
const mongoose = require("mongoose");
const webpush = require("web-push");

const vapid = webpush.generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = vapid.publicKey;
process.env.VAPID_PRIVATE_KEY = vapid.privateKey;
process.env.VAPID_SUBJECT = "mailto:test@example.com";

const User = require("../models/User");
const Alert = require("../models/Alert");
const Portfolio = require("../models/Portfolio");
const WalletTx = require("../models/WalletTx");
const ProfitRecord = require("../models/ProfitRecord");
const PushSubscription = require("../models/PushSubscription");
const rpcService = require("../services/rpc.service");
const notifyService = require("../services/notify.service");
const cg = require("../services/coingecko.service");
const market = require("../services/market.service");
const profit = require("../services/profit.service");
const walletActivity = require("../services/walletActivity.service");
const wallet = require("../controllers/wallet.controller");
const profits = require("../controllers/profits.controller");

const CHAIN = 84532;
const USDC = "0x036cbd53842c5426634e7929541ec2318f3dcf7e";
const TOKEN = "0x4200000000000000000000000000000000000006";
const ROUTER = "0x94cc0aac535ccdb3c01d6787d6413c739ae12bc4";
const WALLET = "0x1111111111111111111111111111111111111111";
const PROFIT_WALLET = "0x3333333333333333333333333333333333333333";
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

let seq = 0;
const hash = () => "0x" + (++seq + 1000).toString(16).padStart(64, "0");
const topic = (a) => "0x" + a.toLowerCase().replace(/^0x/, "").padStart(64, "0");

let pushes;
let emails;

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

async function anOwner() {
  const user = await User.create({
    name: "Trader",
    email: `profit-${Date.now()}-${++seq}@example.com`,
    passwordHash: "x",
    emailVerified: true,
    walletAddress: WALLET,
  });
  await PushSubscription.create({
    userId: user._id,
    endpoint: `https://fcm.googleapis.com/fcm/send/profit-${seq}`,
    keys: { p256dh: "B".repeat(87), auth: "A".repeat(22) },
  });
  return user;
}

function priceIs(usd) {
  cg._resetForTests();
  vi.spyOn(axios, "get").mockResolvedValue({
    data: [{ id: "bitcoin", symbol: "btc", name: "Bitcoin", current_price: usd, image: null }],
  });
}

async function anAlert(user, suggestion, price) {
  return Alert.create({
    mode: "paper",
    userId: user._id,
    watchId: new mongoose.Types.ObjectId(),
    coinId: "bitcoin",
    symbol: "btc",
    message: "test",
    suggestion,
    priceAtAlert: price,
    status: "pending",
  });
}

beforeEach(() => {
  pushes = [];
  emails = [];
  vi.spyOn(webpush, "sendNotification").mockImplementation(async (sub, body) => {
    pushes.push(JSON.parse(body));
    return { statusCode: 201 };
  });
  vi.spyOn(notifyService, "sendEmail").mockImplementation(async (to, subject, html) => {
    emails.push({ to, subject, html });
    return { ok: true };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("profit agent — paper trading", () => {
  it("moves exactly the realised profit from trading cash to the profit balance, and says so", async () => {
    const user = await anOwner();
    priceIs(50000);
    await market.actOnAlert(user._id, await anAlert(user, "buy", 50000), { action: "buy", amount: 1000, denom: "quote" });

    priceIs(60000);
    const sold = await market.actOnAlert(user._id, await anAlert(user, "sell", 60000), { action: "sell", amount: 0.02, denom: "token" });

    expect(sold.profit).toMatchObject({ status: "moved", profitUsd: expect.closeTo(200, 6), mode: "paper" });
    const book = await Portfolio.findOne({ userId: user._id, mode: "paper" }).lean();
    expect(book.profitBalance).toBeCloseTo(200, 6);
    expect(book.cashBalance).toBeCloseTo(1000000, 6);
    expect(sold.portfolio.totalValue).toBeCloseTo(1000200, 6);
    expect(sold.portfolio.profitBalance).toBeCloseTo(200, 6);

    await vi.waitFor(() => expect(pushes.some((p) => p.type === "profit")).toBe(true));
    const notice = pushes.find((p) => p.type === "profit");
    expect(notice.title).toBe("Paper profit of $200.00 on BTC");
    await vi.waitFor(() => expect(emails.some((e) => e.subject === "Paper profit of $200.00 on BTC")).toBe(true));
    const record = await ProfitRecord.findById(sold.profit._id).lean();
    expect(record.message).toContain("$200.00");
  });

  it("records a loss without moving anything or announcing a profit", async () => {
    const user = await anOwner();
    priceIs(50000);
    await market.actOnAlert(user._id, await anAlert(user, "buy", 50000), { action: "buy", amount: 1000, denom: "quote" });
    priceIs(40000);
    const sold = await market.actOnAlert(user._id, await anAlert(user, "sell", 40000), { action: "sell", amount: 0.02, denom: "token" });
    expect(sold.profit).toMatchObject({ status: "loss", profitUsd: expect.closeTo(-200, 6) });
    expect((await Portfolio.findOne({ userId: user._id, mode: "paper" }).lean()).profitBalance).toBe(0);
    await new Promise((r) => setTimeout(r, 50));
    expect(pushes.some((p) => p.type === "profit")).toBe(false);
  });

  it("takes profit on the agent's own sell suggestion too", async () => {
    const user = await anOwner();
    priceIs(50000);
    await market.approveAlert(user._id, await anAlert(user, "buy", 50000));
    priceIs(55000);
    const sold = await market.approveAlert(user._id, await anAlert(user, "sell", 55000));
    expect(sold.profit.status).toBe("moved");
    const book = await Portfolio.findOne({ userId: user._id, mode: "paper" }).lean();
    expect(book.profitBalance).toBeCloseTo(sold.profit.profitUsd, 6);
    expect(sold.profit.profitUsd).toBeGreaterThan(0);
  });

  it("announces every paper fill", async () => {
    const user = await anOwner();
    priceIs(50000);
    await market.actOnAlert(user._id, await anAlert(user, "buy", 50000), { action: "buy", amount: 500, denom: "quote" });
    await vi.waitFor(() => expect(pushes.some((p) => p.type === "trades")).toBe(true));
    expect(pushes.find((p) => p.type === "trades").title).toBe("Paper buy filled: 0.01 BTC");
  });
});

describe("profit agent — live trading", () => {
  async function swap(user, extra) {
    return WalletTx.create({
      userId: user._id,
      chainId: CHAIN,
      hash: hash(),
      from: WALLET,
      to: ROUTER,
      kind: "swap",
      status: "pending",
      createdAt: new Date(Date.now() - 60 * 1000 + seq),
      ...extra,
    });
  }

  const buy = (value, amountOut) => ({ side: "buy", value, symbol: "USDC", tokenAddress: USDC, tokenOut: TOKEN, tokenOutSymbol: "WETH", amountOut });
  const sell = (value, amountOut) => ({ side: "sell", value, symbol: "WETH", tokenAddress: TOKEN, tokenOut: USDC, tokenOutSymbol: "USDC", amountOut });

  function receipts(received) {
    vi.spyOn(rpcService, "rpcCallTyped").mockImplementation(async (chain, method, params) => {
      if (method === "eth_getTransactionReceipt") {
        const got = received[params[0]];
        const logs = got
          ? [{ address: got.token, topics: [TRANSFER, topic(ROUTER), topic(WALLET)], data: "0x" + BigInt(got.raw).toString(16).padStart(64, "0") }]
          : [];
        return { ok: true, result: { status: "0x1", logs } };
      }
      return { ok: false, reason: "unexpected" };
    });
  }

  async function confirm(tx) {
    await WalletTx.updateOne({ _id: tx._id }, { $set: { status: "confirmed" } });
    await walletActivity.announceWalletTx(tx._id);
  }

  it("measures the profit from what the chain says arrived, and holds it for the owner to move", async () => {
    const user = await anOwner();
    const b = await swap(user, buy("100", "0.05"));
    const s = await swap(user, sell("0.05", "120"));
    receipts({
      [b.hash]: { token: TOKEN, raw: 5n * 10n ** 16n },
      [s.hash]: { token: USDC, raw: 121_000_000n },
    });
    await confirm(b);
    await confirm(s);

    const record = await ProfitRecord.findOne({ txId: s._id }).lean();
    expect(record).toMatchObject({ status: "pending", mode: "live", cashSymbol: "USDC", profitAmount: "21", cashDecimals: 6 });
    expect(record.profitUsd).toBeCloseTo(21, 6);
    expect(record.basisEstimated).toBe(false);
    await vi.waitFor(() => expect(pushes.some((p) => p.type === "profit")).toBe(true));
    expect(pushes.find((p) => p.type === "profit").title).toBe("Profit of $21.00 on WETH");
  });

  it("only counts the part of a sale it has a purchase price for", async () => {
    const user = await anOwner();
    const b = await swap(user, buy("100", "0.05"));
    const s = await swap(user, sell("0.1", "300"));
    receipts({ [b.hash]: { token: TOKEN, raw: 5n * 10n ** 16n }, [s.hash]: { token: USDC, raw: 300_000_000n } });
    await confirm(b);
    await confirm(s);
    const record = await ProfitRecord.findOne({ txId: s._id }).lean();
    expect(record.coveredQty).toBeCloseTo(0.05, 12);
    expect(record.profitUsd).toBeCloseTo(50, 6);
    expect(record.note).toMatch(/Only 0.05 of the 0.1 WETH/);
  });

  it("says plainly when there is no recorded purchase, instead of inventing a profit", async () => {
    const user = await anOwner();
    const s = await swap(user, sell("1", "2000"));
    receipts({ [s.hash]: { token: USDC, raw: 2_000_000_000n } });
    await confirm(s);
    const record = await ProfitRecord.findOne({ txId: s._id }).lean();
    expect(record.status).toBe("no-basis");
    expect(record.profitAmount).toBeNull();
    await new Promise((r) => setTimeout(r, 50));
    expect(pushes.some((p) => p.type === "profit")).toBe(false);
  });

  it("records each sale once, however many times it is announced", async () => {
    const user = await anOwner();
    const b = await swap(user, buy("100", "0.05"));
    const s = await swap(user, sell("0.05", "120"));
    receipts({ [b.hash]: { token: TOKEN, raw: 5n * 10n ** 16n }, [s.hash]: { token: USDC, raw: 120_000_000n } });
    await confirm(b);
    await confirm(s);
    await profit.onLiveSwapConfirmed(await WalletTx.findById(s._id).lean());
    expect(await ProfitRecord.countDocuments({ txId: s._id })).toBe(1);
  });

  describe("moving a live profit", () => {
    async function pendingProfit(user) {
      return ProfitRecord.create({
        userId: user._id,
        mode: "live",
        status: "pending",
        symbol: "WETH",
        chainId: CHAIN,
        qty: 0.05,
        profitUsd: 21,
        cashSymbol: "USDC",
        cashAddress: USDC,
        cashDecimals: 6,
        profitAmount: "21",
      });
    }

    async function record(user, body) {
      const res = mockRes();
      await wallet.recordTx({ user, body }, res);
      return res;
    }

    const move = (profitId, extra = {}) => ({
      chainId: CHAIN,
      hash: hash(),
      from: WALLET,
      to: PROFIT_WALLET,
      value: "21",
      symbol: "USDC",
      tokenAddress: USDC,
      direction: "out",
      profitId: String(profitId),
      ...extra,
    });

    it("accepts a move of at most the profit, in the token it was made in, and confirms it when the chain does", async () => {
      const user = await anOwner();
      const p = await pendingProfit(user);
      const res = await record(user, move(p._id));
      expect(res.statusCode).toBe(201);
      expect((await ProfitRecord.findById(p._id).lean()).status).toBe("moving");
      expect((await User.findById(user._id).lean()).profitAddress).toBe(PROFIT_WALLET);

      await WalletTx.updateOne({ _id: res.body.tx._id }, { $set: { status: "confirmed" } });
      await walletActivity.announceWalletTx(res.body.tx._id);
      const done = await ProfitRecord.findById(p._id).lean();
      expect(done.status).toBe("moved");
      expect(done.moveTxHash).toBe(res.body.tx.hash);
      await vi.waitFor(() => expect(pushes).toHaveLength(1));
      expect(pushes[0].title).toBe("21 USDC moved to your profit wallet");
    });

    it("refuses more than the profit, another token or another chain", async () => {
      const user = await anOwner();
      const p = await pendingProfit(user);
      expect((await record(user, move(p._id, { value: "21.01" }))).body.code).toBe("profit_mismatch");
      expect((await record(user, move(p._id, { tokenAddress: TOKEN, symbol: "WETH" }))).body.code).toBe("profit_mismatch");
      expect((await record(user, move(p._id, { chainId: 11155111 }))).body.code).toBe("profit_mismatch");
      expect((await record(user, move(p._id, { kind: "swap" }))).body.code).toBe("profit_mismatch");
      expect((await ProfitRecord.findById(p._id).lean()).status).toBe("pending");
    });

    it("refuses someone else's profit, and one already moved", async () => {
      const owner = await anOwner();
      const other = await anOwner();
      const p = await pendingProfit(owner);
      expect((await record(other, move(p._id))).body.code).toBe("profit_closed");
      await ProfitRecord.updateOne({ _id: p._id }, { $set: { status: "moved" } });
      expect((await record(owner, move(p._id))).body.code).toBe("profit_closed");
      expect((await record(owner, move("not-an-id"))).statusCode).toBe(400);
    });

    it("puts the profit back to waiting when the move fails on chain", async () => {
      const user = await anOwner();
      const p = await pendingProfit(user);
      const res = await record(user, move(p._id));
      await WalletTx.updateOne({ _id: res.body.tx._id }, { $set: { status: "failed" } });
      await walletActivity.announceWalletTx(res.body.tx._id);
      expect((await ProfitRecord.findById(p._id).lean()).status).toBe("pending");
    });

    it("lets the owner keep a profit in the trading wallet instead", async () => {
      const user = await anOwner();
      const p = await pendingProfit(user);
      const res = mockRes();
      await profits.dismiss({ user, params: { id: String(p._id) } }, res);
      expect(res.body.profit.status).toBe("dismissed");
      const again = mockRes();
      await profits.dismiss({ user, params: { id: String(p._id) } }, again);
      expect(again.statusCode).toBe(409);
    });

    it("lists profits with totals for each mode", async () => {
      const user = await anOwner();
      await pendingProfit(user);
      await ProfitRecord.create({ userId: user._id, mode: "paper", status: "moved", symbol: "BTC", qty: 1, profitUsd: 200 });
      const res = mockRes();
      await profits.list({ user, query: {} }, res);
      expect(res.body.totals).toMatchObject({ paper: 200, live: 21, pendingLive: 21, movedLive: 0 });
      expect(res.body.profits).toHaveLength(2);
    });
  });
});

describe("profit agent — arithmetic", () => {
  it("never rounds a profit up past what was made", () => {
    expect(profit.floorTo(20.9999999, 6)).toBe("20.999999");
    expect(profit.floorTo(21, 6)).toBe("21");
    expect(profit.floorTo(0.123456789, 18)).toBe("0.123456789");
  });

  it("writes a plain message when no AI key is set", () => {
    const text = profit.templateMessage({ mode: "live", symbol: "WETH", qty: 0.05, avgCost: 2000, price: 2420, profitUsd: 21, profitPct: 21, cashSymbol: "USDC" });
    expect(text).toContain("a profit of $21.00 (21.00%)");
    expect(text).not.toMatch(/[—–]/);
  });
});
