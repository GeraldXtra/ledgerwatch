process.env.SMTP_HOST = "";
process.env.SMTP_USER = "";
process.env.SMTP_PASS = "";
process.env.VAPID_PRIVATE_KEY = "";
process.env.TWILIO_ACCOUNT_SID = "";

const Debt = require("../models/Debt");
const Payment = require("../models/Payment");
const PaymentAddress = require("../models/PaymentAddress");
const User = require("../models/User");
const { settleIfDue, TOLERANCE } = require("../services/paymentWatch.service");

const CHAIN = { chainId: 84532, name: "Base Sepolia" };
const NGN_PER_USD = 1360;

const usdc = (amount) => String(Math.round(amount * 1e6));

async function scenarioPartiallyPaid() {
  const user = await User.create({
    name: "Owner",
    email: `owner-${Date.now()}@example.com`,
    passwordHash: "not-a-real-hash",
  });

  const debt = await Debt.create({
    userId: user._id,
    debtorName: "Zenith Trading",
    amount: 100000,
    dueDate: new Date(),
  });

  const first = await Payment.create({
    debtId: debt._id,
    userId: user._id,
    amount: 68000,
    method: "crypto",
    txHash: "0xaaa1",
  });

  const pa = await PaymentAddress.create({
    userId: user._id,
    debtId: debt._id,
    chainId: CHAIN.chainId,
    derivationIndex: 19,
    address: "0x000000000000000000000000000000000000dEaD",
    tokenSymbol: "USDC",
    tokenContract: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    tokenDecimals: 6,
    invoiceBalanceNgn: 32000,
    expectedUsdc: 23.53,
    ngnPerUsd: NGN_PER_USD,
    rateTimestamp: new Date(),
    expiresAt: new Date(Date.now() + 72 * 3600 * 1000),
    status: "active",
    observed: [
      {
        txHash: "0xaaa1",
        from: "0x1111111111111111111111111111111111111111",
        value: usdc(50),
        blockNumber: 100,
        confirmations: 30,
        status: "confirmed",
        settledPaymentId: first._id,
      },
    ],
  });

  return { user, debt, pa };
}

describe("LW-004: settlement basis", () => {
  it("does NOT mark an invoice fully paid when one cent arrives after a part payment", async () => {
    const { debt, pa } = await scenarioPartiallyPaid();

    pa.observed.push({
      txHash: "0xbbb2",
      from: "0x2222222222222222222222222222222222222222",
      value: usdc(0.01),
      blockNumber: 200,
      confirmations: 30,
      status: "confirmed",
      settledPaymentId: null,
    });
    await pa.save();

    const result = await settleIfDue(pa, CHAIN);

    expect(result).toBeTruthy();
    expect(result.fullyPaid).toBe(false);

    const payments = await Payment.find({ debtId: debt._id }).sort({ amount: 1 }).lean();
    expect(payments).toHaveLength(2);
    const newest = payments.find((p) => p.txHash === "0xbbb2");
    expect(newest).toBeTruthy();
    expect(newest.amount).toBeCloseTo(13.6, 2);

    const total = payments.reduce((s, p) => s + p.amount, 0);
    expect(100000 - total).toBeCloseTo(31986.4, 2);

    const after = await PaymentAddress.findById(pa._id).lean();
    expect(after.status).toBe("active");
  });

  it("DOES mark it fully paid when the remaining amount actually arrives", async () => {
    const { debt, pa } = await scenarioPartiallyPaid();

    pa.observed.push({
      txHash: "0xccc3",
      from: "0x3333333333333333333333333333333333333333",
      value: usdc(23.53),
      blockNumber: 200,
      confirmations: 30,
      status: "confirmed",
      settledPaymentId: null,
    });
    await pa.save();

    const result = await settleIfDue(pa, CHAIN);

    expect(result.fullyPaid).toBe(true);

    const payments = await Payment.find({ debtId: debt._id }).lean();
    const total = payments.reduce((s, p) => s + p.amount, 0);
    expect(total).toBeCloseTo(100000, 2);

    const after = await PaymentAddress.findById(pa._id).lean();
    expect(after.status).toBe("paid");
  });

  it("treats an overpayment on the remaining basis, not the cumulative one", async () => {
    const { pa } = await scenarioPartiallyPaid();

    pa.observed.push({
      txHash: "0xddd4",
      from: "0x4444444444444444444444444444444444444444",
      value: usdc(30),
      blockNumber: 200,
      confirmations: 30,
      status: "confirmed",
      settledPaymentId: null,
    });
    await pa.save();

    await settleIfDue(pa, CHAIN);

    const after = await PaymentAddress.findById(pa._id).lean();
    expect(after.overpaidUsdc).toBeCloseTo(6.47, 2);
  });

  it("keeps the tolerance meaningful rather than absolute", () => {
    expect(TOLERANCE).toBeGreaterThan(0);
    expect(TOLERANCE).toBeLessThan(0.05);
  });
});
