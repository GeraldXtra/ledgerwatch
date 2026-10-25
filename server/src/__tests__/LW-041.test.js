process.env.JWT_SECRET = process.env.JWT_SECRET || "lw-confirmations-tests-only-0123456789abcd";

const app = require("../app");
const User = require("../models/User");
const Debt = require("../models/Debt");
const PaymentAddress = require("../models/PaymentAddress");
const signToken = require("../utils/token");

let server;
let base;
let saved;

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
  saved = process.env.CONFIRMATIONS_84532;
});

afterEach(() => {
  if (saved === undefined) delete process.env.CONFIRMATIONS_84532;
  else process.env.CONFIRMATIONS_84532 = saved;
});

async function get(path, token) {
  const res = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  return res.json();
}

describe("LW-041 — the confirmation depth shown is the depth the server uses", () => {
  it("serves the server's depth, including a CONFIRMATIONS_ variable and the owner's override", async () => {
    process.env.CONFIRMATIONS_84532 = "9";
    const plain = await User.create({ name: "Depth", email: `depth-${Date.now()}@example.com`, passwordHash: "x" });
    const custom = await User.create({
      name: "Depth",
      email: `depth-custom-${Date.now()}@example.com`,
      passwordHash: "x",
      crypto: { confirmationOverrides: { 84532: 21 } },
    });

    const forPlain = (await get("/api/wallet/chains", signToken(plain._id, 0))).chains.find((c) => c.chainId === 84532);
    expect(forPlain).toMatchObject({ recommendedConfirmations: 9, confirmations: 9 });

    const forCustom = (await get("/api/wallet/chains", signToken(custom._id, 0))).chains.find((c) => c.chainId === 84532);
    expect(forCustom).toMatchObject({ recommendedConfirmations: 9, confirmations: 21 });
  });

  it("puts the required depth on every payment address it lists", async () => {
    const user = await User.create({
      name: "Depth",
      email: `depth-list-${Date.now()}@example.com`,
      passwordHash: "x",
      crypto: { confirmationOverrides: { 84532: 15 } },
    });
    const debt = await Debt.create({ userId: user._id, debtorName: "D", amount: 100, dueDate: new Date() });
    await PaymentAddress.create({
      userId: user._id,
      debtId: debt._id,
      chainId: 84532,
      derivationIndex: 0,
      address: `0x${"c".repeat(40)}`,
      tokenSymbol: "USDC",
      tokenContract: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      tokenDecimals: 6,
      invoiceBalanceNgn: 100,
      expectedUsdc: 0.07,
      ngnPerUsd: 1600,
      rateTimestamp: new Date(),
      status: "active",
      expiresAt: new Date(Date.now() + 3600 * 1000),
    });
    const listed = await get("/api/payment-addresses", signToken(user._id, 0));
    expect(listed.addresses[0].confirmationsRequired).toBe(15);
  });

  it("refuses an override for a network that does not exist, or a count out of range, instead of dropping it", async () => {
    const user = await User.create({ name: "Depth", email: `depth-bad-${Date.now()}@example.com`, passwordHash: "x" });
    const token = signToken(user._id, 0);
    const send = (crypto) =>
      fetch(`${base}/api/auth/me`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ crypto }),
      });
    const unknown = await send({ confirmationOverrides: { 999999: 5 } });
    expect(unknown.status).toBe(400);
    expect((await unknown.json()).error).toMatch(/not one LedgerWatch supports/);
    const tooDeep = await send({ confirmationOverrides: { 84532: 301 } });
    expect(tooDeep.status).toBe(400);
    expect((await tooDeep.json()).error).toMatch(/from 1 to 300/);
  });
});
