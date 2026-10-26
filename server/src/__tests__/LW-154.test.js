process.env.JWT_SECRET = process.env.JWT_SECRET || "lw-154-expired-address-tests-0123456789abc";
process.env.SMTP_HOST = "";
process.env.ANTHROPIC_API_KEY = "";

const rpc = require("../services/rpc.service");
const cg = require("../services/coingecko.service");
rpc.rpcCall = async () => null;
cg.getNgnPrice = async () => ({ ngn: 1500, fetchedAt: Date.now(), stale: false });

const app = require("../app");
const User = require("../models/User");
const Debt = require("../models/Debt");
const PaymentAddress = require("../models/PaymentAddress");
const signToken = require("../utils/token");

const CHAIN_ID = 84532;
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

let server;
let base;
let seq = 0;

beforeAll(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
  await PaymentAddress.init();
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function call(method, path, { token, body, query } = {}) {
  const qs = query ? `?${new URLSearchParams(query)}` : "";
  const res = await fetch(`${base}${path}${qs}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function ownerWithInvoice() {
  const user = await User.create({
    name: "Ada",
    email: `lw154-${Date.now()}-${++seq}@example.com`,
    passwordHash: "x",
    emailVerified: true,
    crypto: { enabled: true, nextDerivationIndex: 5 },
  });
  const debt = await Debt.create({
    userId: user._id,
    debtorName: "Bola Stores",
    amount: 45000,
    amountKobo: 4500000,
    dueDate: new Date(Date.now() - 86400000),
    status: "pending",
    history: [],
  });
  return { user, debt, token: signToken(user._id, user.tokenVersion) };
}

async function lapsedAddress(user, debt) {
  return PaymentAddress.create({
    userId: user._id,
    debtId: debt._id,
    chainId: CHAIN_ID,
    derivationIndex: 0,
    address: `0x${"c".repeat(40)}`,
    tokenSymbol: "USDC",
    tokenContract: USDC,
    tokenDecimals: 6,
    invoiceBalanceNgn: 45000,
    expectedUsdc: 30,
    ngnPerUsd: 1500,
    rateTimestamp: new Date(),
    status: "active",
    expiresAt: new Date(Date.now() - 2 * 3600000),
    createdAt: new Date(Date.now() - 5 * 86400000),
  });
}

describe("LW-154 — an address past its expiry does not block a new one until the watcher happens to run", () => {
  it("the quote no longer reports a lapsed address as active, and marks it expired", async () => {
    const { user, debt, token } = await ownerWithInvoice();
    const old = await lapsedAddress(user, debt);
    const quote = await call("GET", "/api/payment-addresses/quote", { token, query: { debtId: String(debt._id), chainId: CHAIN_ID, tokenSymbol: "USDC" } });
    expect(quote.status).toBe(200);
    expect(quote.body.hasActiveAddress).toBe(false);
    const row = await PaymentAddress.findById(old._id).lean();
    expect(row.status).toBe("expired");
    expect(row.expiredAt).toBeInstanceOf(Date);
  });

  it("a new address can be issued straight away for the same invoice", async () => {
    const { user, debt, token } = await ownerWithInvoice();
    await lapsedAddress(user, debt);
    const alloc = await call("POST", "/api/payment-addresses/allocate", { token, body: { chainId: CHAIN_ID } });
    expect(alloc.status).toBe(200);
    const created = await call("POST", "/api/payment-addresses", {
      token,
      body: { debtId: String(debt._id), chainId: CHAIN_ID, address: `0x${"d".repeat(40)}`, derivationIndex: alloc.body.derivationIndex, tokenSymbol: "USDC" },
    });
    expect(created.status).toBe(201);
    expect(created.body.paymentAddress.status).toBe("active");
    const statuses = (await PaymentAddress.find({ debtId: debt._id }).lean()).map((a) => a.status).sort();
    expect(statuses).toEqual(["active", "expired"]);
  });

  it("an address that is still within its expiry keeps blocking a second one", async () => {
    const { user, debt, token } = await ownerWithInvoice();
    const live = await lapsedAddress(user, debt);
    await PaymentAddress.updateOne({ _id: live._id }, { $set: { expiresAt: new Date(Date.now() + 3600000) } });
    const quote = await call("GET", "/api/payment-addresses/quote", { token, query: { debtId: String(debt._id), chainId: CHAIN_ID } });
    expect(quote.body.hasActiveAddress).toBe(true);
    const created = await call("POST", "/api/payment-addresses", {
      token,
      body: { debtId: String(debt._id), chainId: CHAIN_ID, address: `0x${"e".repeat(40)}`, derivationIndex: 9, tokenSymbol: "USDC" },
    });
    expect(created.status).toBe(409);
  });

  it("the list shows the lapsed address as expired without waiting for a pass", async () => {
    const { user, debt, token } = await ownerWithInvoice();
    await lapsedAddress(user, debt);
    const list = await call("GET", "/api/payment-addresses", { token, query: { debtId: String(debt._id) } });
    expect(list.status).toBe(200);
    expect(list.body.addresses).toHaveLength(1);
    expect(list.body.addresses[0].status).toBe("expired");
  });
});
