/**
 * LW-051 — the settlement tolerance must be capped in absolute terms.
 *
 * THE DEFECT. `fullyPaid` was `unsettled >= expected * (1 - TOLERANCE)` with
 * TOLERANCE at 0.5 percent. That percentage scales with the invoice, and on a
 * full payment `creditNgn` credits the ENTIRE remaining balance. So a large
 * invoice could be closed while genuinely short, with the ledger recording the
 * whole amount as received:
 *
 *     invoice NGN 326,480,000  ->  240,058.82 USDC expected
 *                                  238,858.53 USDC accepted as paid in full
 *                                  NGN 1,632,400 recorded but never sent
 *
 * The reminders stop, the debtor is marked settled, and the owner's collected
 * figure includes money nobody paid. That is money invented in the book of
 * account. Harmless on a testnet, which is the only reason it survived.
 *
 * The tolerance exists to absorb ROUNDING on a two decimal quote, which is a
 * fraction of a cent, so it is now the smaller of the percentage and a few
 * cents. Small invoices are unaffected.
 */

process.env.SMTP_HOST = "";
process.env.SMTP_USER = "";
process.env.SMTP_PASS = "";
process.env.VAPID_PRIVATE_KEY = "";
process.env.TWILIO_ACCOUNT_SID = "";

const Debt = require("../models/Debt");
const Payment = require("../models/Payment");
const PaymentAddress = require("../models/PaymentAddress");
const User = require("../models/User");
const {
  settleIfDue,
  toleratedShortfall,
  MAX_SHORTFALL,
  TOLERANCE,
} = require("../services/paymentWatch.service");

const CHAIN = { chainId: 1, name: "Ethereum" };
const usdc = (amount) => String(Math.round(amount * 1e6));

async function invoiceFor(amountNgn, expectedUsdc) {
  const user = await User.create({
    name: "Owner",
    email: `owner-${Date.now()}-${Math.round(performance.now())}@example.com`,
    passwordHash: "not-a-real-hash",
  });
  const debt = await Debt.create({
    userId: user._id,
    debtorName: "Dangote Cement",
    amount: amountNgn,
    dueDate: new Date(),
  });
  const pa = await PaymentAddress.create({
    userId: user._id,
    debtId: debt._id,
    chainId: CHAIN.chainId,
    derivationIndex: Math.floor(Math.random() * 100000),
    address: `0x${Math.floor(Math.random() * 1e16).toString(16).padStart(40, "0")}`,
    tokenSymbol: "USDC",
    tokenContract: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    tokenDecimals: 6,
    invoiceBalanceNgn: amountNgn,
    expectedUsdc,
    ngnPerUsd: 1360,
    rateTimestamp: new Date(),
    expiresAt: new Date(Date.now() + 72 * 3600 * 1000),
    status: "active",
    observed: [],
  });
  return { user, debt, pa };
}

describe("LW-051: the settlement tolerance is capped in absolute terms", () => {
  it("caps the tolerated shortfall at a few cents however large the invoice", () => {
    // Small invoice: the percentage is smaller than the cap, so nothing changes.
    expect(toleratedShortfall(7.35)).toBeCloseTo(7.35 * TOLERANCE, 6);

    // Large invoice: the cap bites, hard.
    expect(toleratedShortfall(240058.82)).toBe(MAX_SHORTFALL);
    expect(MAX_SHORTFALL).toBeLessThanOrEqual(0.05);
  });

  it("does NOT close a large invoice that is short by 0.4 percent", async () => {
    // NGN 326,480,000 at 1360 per USD.
    const expected = 240058.82;
    const { debt, pa } = await invoiceFor(326480000, expected);

    // 0.4 percent short: about 960 USDC, roughly NGN 1.3 million. Under the old
    // proportional tolerance this satisfied the comparison and closed the whole
    // invoice.
    pa.observed.push({
      txHash: "0xshort01",
      from: "0x1111111111111111111111111111111111111111",
      value: usdc(expected * 0.996),
      blockNumber: 100,
      confirmations: 30,
      status: "confirmed",
      settledPaymentId: null,
    });
    await pa.save();

    const result = await settleIfDue(pa, CHAIN);

    expect(result.fullyPaid).toBe(false);

    // It credits what actually arrived and leaves the rest open, rather than
    // recording NGN 1.3 million that nobody sent.
    const payments = await Payment.find({ debtId: debt._id }).lean();
    const credited = payments.reduce((s, p) => s + p.amount, 0);
    expect(credited).toBeLessThan(326480000);
    expect(326480000 - credited).toBeGreaterThan(1000000);

    const after = await PaymentAddress.findById(pa._id).lean();
    expect(after.status).toBe("active");
  });

  it("still closes an invoice that is short only by rounding", async () => {
    const expected = 240058.82;
    const { pa } = await invoiceFor(326480000, expected);

    // Two cents short, which is what the tolerance is actually for.
    pa.observed.push({
      txHash: "0xround01",
      from: "0x2222222222222222222222222222222222222222",
      value: usdc(expected - 0.02),
      blockNumber: 100,
      confirmations: 30,
      status: "confirmed",
      settledPaymentId: null,
    });
    await pa.save();

    const result = await settleIfDue(pa, CHAIN);
    expect(result.fullyPaid).toBe(true);
  });

  it("leaves small invoices behaving exactly as before", async () => {
    // NGN 10,000 -> 7.35 USDC. The old tolerance allowed about 0.037 USDC and
    // the cap is 0.05, so the percentage still governs and nothing changed.
    const { pa } = await invoiceFor(10000, 7.35);
    pa.observed.push({
      txHash: "0xsmall01",
      from: "0x3333333333333333333333333333333333333333",
      value: usdc(7.32),
      blockNumber: 100,
      confirmations: 30,
      status: "confirmed",
      settledPaymentId: null,
    });
    await pa.save();

    const result = await settleIfDue(pa, CHAIN);
    expect(result.fullyPaid).toBe(true);
  });
});
