process.env.SMTP_HOST = "";
process.env.SMTP_USER = "";
process.env.SMTP_PASS = "";
process.env.VAPID_PRIVATE_KEY = "";
process.env.TWILIO_ACCOUNT_SID = "";

const Debt = require("../models/Debt");
const Payment = require("../models/Payment");
const PaymentAddress = require("../models/PaymentAddress");
const User = require("../models/User");
const { settleIfDue } = require("../services/paymentWatch.service");

const CHAIN = { chainId: 84532, name: "Base Sepolia" };
const usdc = (amount) => String(Math.round(amount * 1e6));

async function scenarioAlreadySettled() {
  const user = await User.create({
    name: "Owner",
    email: `owner-${Date.now()}-${Math.round(performance.now())}@example.com`,
    passwordHash: "not-a-real-hash",
  });

  const debt = await Debt.create({
    userId: user._id,
    debtorName: "Dangote Cement",
    amount: 10000,
    dueDate: new Date(),
    status: "paid",
  });

  await Payment.create({
    debtId: debt._id,
    userId: user._id,
    amount: 10000,
    method: "other",
  });

  const pa = await PaymentAddress.create({
    userId: user._id,
    debtId: debt._id,
    chainId: CHAIN.chainId,
    derivationIndex: 16,
    address: "0x00000000000000000000000000000000000dEaD1",
    tokenSymbol: "USDC",
    tokenContract: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    tokenDecimals: 6,
    invoiceBalanceNgn: 10000,
    expectedUsdc: 7.35,
    ngnPerUsd: 1360,
    rateTimestamp: new Date(),
    expiresAt: new Date(Date.now() + -24 * 3600 * 1000),
    status: "active",
    observed: [
      {
        txHash: "0xfeed01",
        from: "0x5555555555555555555555555555555555555555",
        value: usdc(7.35),
        blockNumber: 500,
        confirmations: 131,
        status: "confirmed",
        settledPaymentId: null,
      },
    ],
  });

  return { user, debt, pa };
}

describe("LW-002: money arriving with nothing owed", () => {
  it("records it as unattributed instead of returning silently", async () => {
    const { pa } = await scenarioAlreadySettled();

    const result = await settleIfDue(pa, CHAIN);

    expect(result).toBeTruthy();
    expect(result.outcome).toBe("UNATTRIBUTED");
    expect(result.unattributedUsdc).toBeCloseTo(7.35, 2);

    const after = await PaymentAddress.findById(pa._id).lean();
    expect(after.unattributedUsdc).toBeCloseTo(7.35, 2);
    expect(after.unattributedAt).toBeTruthy();

    expect(after.receivedUsdc).toBeCloseTo(7.35, 2);

    expect(after.unidentifiedBalanceAt).toBeTruthy();
  });

  it("does NOT invent a Payment for an invoice that owes nothing", async () => {
    const { debt, pa } = await scenarioAlreadySettled();

    await settleIfDue(pa, CHAIN);

    const payments = await Payment.find({ debtId: debt._id }).lean();
    expect(payments).toHaveLength(1);
    expect(payments[0].method).toBe("other");
  });

  it("accumulates rather than overwriting when a second one arrives", async () => {
    const { pa } = await scenarioAlreadySettled();

    await settleIfDue(pa, CHAIN);

    const reloaded = await PaymentAddress.findById(pa._id);
    reloaded.observed.push({
      txHash: "0xfeed02",
      from: "0x6666666666666666666666666666666666666666",
      value: usdc(2.5),
      blockNumber: 600,
      confirmations: 40,
      status: "confirmed",
      settledPaymentId: null,
    });
    await reloaded.save();

    await settleIfDue(reloaded, CHAIN);

    const after = await PaymentAddress.findById(pa._id).lean();
    expect(after.unattributedUsdc).toBeCloseTo(9.85, 2);
  });
});
