/**
 * LW-004 — settlement must compare figures on the SAME basis.
 *
 * THE DEFECT. `totalUsdc` was the cumulative sum of every confirmed transfer
 * this address had ever received. `pa.expectedUsdc` is REMAINING: resync
 * rewrites it after each partial settlement to what is still owed. The two were
 * compared directly, so after any partial settlement the comparison was
 * permanently biased toward true and the next transfer of ANY size settled the
 * whole remaining balance.
 *
 * THIS WAS LIVE. PaymentAddress derivationIndex 19 in the development database
 * held receivedUsdc 20 against expectedUsdc 16.72 on a balance of 22,759.60
 * naira. One cent would have closed it. derivationIndex 18 had the same shape.
 *
 * The scenario below is that shape, in miniature.
 */

// Blank every outbound integration BEFORE anything is required, so a test can
// never send a real reminder, receipt or push. SMTP is configured on this
// machine, so this is not hypothetical.
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

/** USDC has 6 decimals, so one dollar is 1,000,000 base units. */
const usdc = (amount) => String(Math.round(amount * 1e6));

async function scenarioPartiallyPaid() {
  const user = await User.create({
    name: "Owner",
    email: `owner-${Date.now()}@example.com`,
    passwordHash: "not-a-real-hash",
  });

  // A 100,000 naira invoice.
  const debt = await Debt.create({
    userId: user._id,
    debtorName: "Zenith Trading",
    amount: 100000,
    dueDate: new Date(),
  });

  // 50 USDC already arrived and settled: 50 x 1360 = 68,000 naira.
  const first = await Payment.create({
    debtId: debt._id,
    userId: user._id,
    amount: 68000,
    method: "crypto",
    txHash: "0xaaa1",
  });

  // 32,000 naira is still open, which resync has rewritten expectedUsdc to:
  // 32000 / 1360 = 23.53 USDC.
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
    // Required by the schema. Still open, which is the state each scenario needs.
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

    // The next transfer: 0.01 USDC. Under the defect this satisfied
    // 50.01 >= 23.53 x (1 - TOLERANCE) and closed the whole 32,000 naira.
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

    // It credits what actually arrived, not the remainder: 0.01 x 1360 = 13.60.
    const payments = await Payment.find({ debtId: debt._id }).sort({ amount: 1 }).lean();
    expect(payments).toHaveLength(2);
    const newest = payments.find((p) => p.txHash === "0xbbb2");
    expect(newest).toBeTruthy();
    expect(newest.amount).toBeCloseTo(13.6, 2);

    // And the invoice is still open for very nearly the whole 32,000.
    const total = payments.reduce((s, p) => s + p.amount, 0);
    expect(100000 - total).toBeCloseTo(31986.4, 2);

    const after = await PaymentAddress.findById(pa._id).lean();
    expect(after.status).toBe("active");
  });

  it("DOES mark it fully paid when the remaining amount actually arrives", async () => {
    const { debt, pa } = await scenarioPartiallyPaid();

    // Exactly what is still expected.
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

    // A full payment credits the entire remainder so the balance lands on zero
    // rather than a few kobo short from rounding.
    const payments = await Payment.find({ debtId: debt._id }).lean();
    const total = payments.reduce((s, p) => s + p.amount, 0);
    expect(total).toBeCloseTo(100000, 2);

    const after = await PaymentAddress.findById(pa._id).lean();
    expect(after.status).toBe("paid");
  });

  it("treats an overpayment on the remaining basis, not the cumulative one", async () => {
    const { pa } = await scenarioPartiallyPaid();

    // 30 USDC against 23.53 expected: about 6.47 over.
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
    // Under the defect this read 30 + 50 - 23.53 = 56.47 and told the owner they
    // had been overpaid by about 76,000 naira that nobody had sent.
    expect(after.overpaidUsdc).toBeCloseTo(6.47, 2);
  });

  it("keeps the tolerance meaningful rather than absolute", () => {
    // A guard on the constant itself: a tolerance of 1 would make every
    // comparison above pass and quietly undo this whole test file.
    expect(TOLERANCE).toBeGreaterThan(0);
    expect(TOLERANCE).toBeLessThan(0.05);
  });
});
