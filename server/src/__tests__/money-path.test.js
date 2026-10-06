/**
 * THE MONEY PATH, END TO END.
 *
 * `docs/BUILD_PLAN.md` P4-3 calls this "the highest-value item in the plan" and
 * it was never built. Every existing test guards one defect in isolation:
 * LW-002 that money is never discarded, LW-004 that the settlement basis is
 * consistent, LW-051 that the tolerance is capped. None of them walk an invoice
 * from issuance to a settled payment, so the seams between those pieces — which
 * is where this audit found most of the real defects — were untested.
 *
 * This walks the whole thing:
 *
 *     issue an address -> a transfer is detected -> it confirms ->
 *     the invoice settles -> the Payment exists, once ->
 *     a second pass changes nothing -> a part payment leaves the right balance
 *
 * It runs against an in-memory MongoDB with the chain mocked, so it asserts the
 * LOGIC, not the network. What it cannot prove is that a real chain behaves as
 * mocked; CLAUDE.md section 11 is right that only money moving proves that.
 * What it does prove is that the pieces still fit together, which is exactly
 * what breaks when somebody changes one of them.
 */

// Blank every outbound integration BEFORE anything is required. SMTP is
// configured on the development machine, so this is not hypothetical.
process.env.SMTP_HOST = "";
process.env.SMTP_USER = "";
process.env.SMTP_PASS = "";
process.env.VAPID_PRIVATE_KEY = "";
process.env.TWILIO_ACCOUNT_SID = "";
process.env.ANTHROPIC_API_KEY = "";

const Debt = require("../models/Debt");
const Payment = require("../models/Payment");
const PaymentAddress = require("../models/PaymentAddress");
const User = require("../models/User");
const { settleIfDue } = require("../services/paymentWatch.service");
const { resyncActivePaymentAddress } = require("../services/paymentAddress.service");
const { recomputeDebtStatus } = require("../services/receivables.service");

const CHAIN = { chainId: 84532, name: "Base Sepolia" };
const NGN_PER_USD = 1600;

/** USDC has 6 decimals: one dollar is 1,000,000 base units. */
const units = (amount) => String(Math.round(amount * 1e6));

let seq = 0;
const nextHash = () => `0x${(++seq).toString(16).padStart(64, "0")}`;

async function anInvoice(amountNgn) {
  const user = await User.create({
    name: "Owner",
    email: `owner-${Date.now()}-${seq}@example.com`,
    passwordHash: "not-a-real-hash",
  });
  const debt = await Debt.create({
    userId: user._id,
    debtorName: "Zenith Trading",
    amount: amountNgn,
    dueDate: new Date(),
  });
  return { user, debt };
}

/**
 * An address as `issueAddress` would have written it, without going near the
 * derivation or the chain. `expectedUsdc` rounds UP, as `usdcForNgn` does.
 */
async function anAddressFor({ user, debt }, { index = 0 } = {}) {
  const expectedUsdc = Math.ceil((debt.amount / NGN_PER_USD) * 100) / 100;
  return PaymentAddress.create({
    userId: user._id,
    debtId: debt._id,
    chainId: CHAIN.chainId,
    derivationIndex: index,
    address: `0x${String(index).padStart(40, "a")}`,
    tokenSymbol: "USDC",
    tokenContract: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    tokenDecimals: 6,
    invoiceBalanceNgn: debt.amount,
    expectedUsdc,
    ngnPerUsd: NGN_PER_USD,
    rateTimestamp: new Date(),
    status: "active",
    expiresAt: new Date(Date.now() + 72 * 3600 * 1000),
  });
}

/** A confirmed transfer, as the watcher stamps one once it is deep enough. */
function aConfirmedTransfer(pa, amountUsdc) {
  pa.observed.push({
    txHash: nextHash(),
    from: "0x000000000000000000000000000000000000dead",
    value: units(amountUsdc),
    blockNumber: 1000 + seq,
    status: "confirmed",
    confirmedAt: new Date(),
  });
  return pa;
}

describe("an invoice paid in full, in one transfer", () => {
  it("settles for the whole balance and records exactly one Payment", async () => {
    const ctx = await anInvoice(100000); // NGN 100,000
    const pa = await anAddressFor(ctx);
    expect(pa.expectedUsdc).toBe(62.5); // 100000 / 1600

    aConfirmedTransfer(pa, 62.5);
    await pa.save();

    const result = await settleIfDue(pa, CHAIN);

    expect(result).toBeTruthy();
    expect(result.fullyPaid).toBe(true);

    const payments = await Payment.find({ debtId: ctx.debt._id });
    expect(payments).toHaveLength(1);
    // Paid in full credits the ENTIRE remaining balance, so the invoice lands on
    // exactly zero rather than a few kobo short from rounding.
    expect(payments[0].amount).toBe(100000);
    expect(payments[0].method).toBe("crypto");

    const after = await PaymentAddress.findById(pa._id);
    expect(after.status).toBe("paid");
    // Every confirmed transfer must be stamped, or the next pass credits it again.
    expect(after.observed.every((o) => o.settledPaymentId)).toBe(true);
  });

  it("is idempotent: a second pass over the same address changes nothing", async () => {
    const ctx = await anInvoice(100000);
    const pa = await anAddressFor(ctx, { index: 1 });
    aConfirmedTransfer(pa, 62.5);
    await pa.save();

    await settleIfDue(pa, CHAIN);
    const second = await settleIfDue(await PaymentAddress.findById(pa._id), CHAIN);

    // Nothing new to settle. The whole point of the stamps.
    expect(second).toEqual({ outcome: "NOTHING_NEW" });
    expect(await Payment.countDocuments({ debtId: ctx.debt._id })).toBe(1);
  });
});

describe("an invoice paid in two parts", () => {
  it("credits each part once and leaves the right balance in between", async () => {
    const ctx = await anInvoice(100000);
    const pa = await anAddressFor(ctx, { index: 2 });

    // ---- first transfer: 40 of the 62.50 asked for --------------------------
    aConfirmedTransfer(pa, 40);
    await pa.save();
    const first = await settleIfDue(pa, CHAIN);

    expect(first.fullyPaid).toBe(false);
    expect(first.creditNgn).toBe(40 * NGN_PER_USD); // 64,000

    let debt = await Debt.findById(ctx.debt._id);
    expect(debt.status).toBe("partially_paid");

    // Resync rewrites what is still expected, at the SNAPSHOT rate. This is the
    // step that makes `expectedUsdc` a REMAINING figure, which is the whole
    // basis question LW-004 was about.
    const resynced = await PaymentAddress.findById(pa._id);
    expect(resynced.expectedUsdc).toBeCloseTo(22.5, 2); // (100000 - 64000) / 1600

    // ---- second transfer: the rest -----------------------------------------
    aConfirmedTransfer(resynced, 22.5);
    await resynced.save();
    const second = await settleIfDue(resynced, CHAIN);

    expect(second.fullyPaid).toBe(true);

    const payments = await Payment.find({ debtId: ctx.debt._id }).sort({ createdAt: 1 });
    expect(payments).toHaveLength(2);
    // The two credits must sum to the invoice exactly — not 64,000 + 100,000,
    // which is what a cumulative-versus-remaining mix-up produces.
    expect(payments.reduce((s, p) => s + p.amount, 0)).toBe(100000);

    debt = await Debt.findById(ctx.debt._id);
    expect(debt.status).toBe("paid");
  });

  it("the panel's own figure agrees with the ledger after a part payment", async () => {
    /**
     * This is the client-side defect the audit found (A3-01), asserted on the
     * server's data so it cannot come back. `receivedUsdc` is CUMULATIVE and
     * `expectedUsdc` is REMAINING; subtracting one from the other reports that
     * nothing is owed on an invoice that is still owed money.
     */
    const ctx = await anInvoice(100000);
    const pa = await anAddressFor(ctx, { index: 3 });
    aConfirmedTransfer(pa, 40);
    await pa.save();
    await settleIfDue(pa, CHAIN);

    const after = await PaymentAddress.findById(pa._id);

    // The WRONG comparison, kept here to show what it produces.
    const wrong = Math.max(0, after.expectedUsdc - after.receivedUsdc);
    expect(wrong).toBe(0); // "Still needed: Nothing" — and it is not true.

    // The RIGHT one: what has arrived and not yet been credited, against what is
    // still expected.
    const unsettled = after.observed
      .filter((o) => o.status === "confirmed" && !o.settledPaymentId)
      .reduce((s, o) => s + Number(o.value) / 1e6, 0);
    const right = Math.max(0, after.expectedUsdc - unsettled);
    expect(right).toBeCloseTo(22.5, 2);
  });
});

describe("an overpayment", () => {
  it("settles the invoice and records the excess rather than absorbing it", async () => {
    const ctx = await anInvoice(100000);
    const pa = await anAddressFor(ctx, { index: 4 });
    aConfirmedTransfer(pa, 70); // 7.50 more than the 62.50 asked
    await pa.save();

    const result = await settleIfDue(pa, CHAIN);
    expect(result.fullyPaid).toBe(true);

    const after = await PaymentAddress.findById(pa._id);
    expect(after.overpaidUsdc).toBeCloseTo(7.5, 2);

    // The invoice is closed for its own amount, never for what arrived.
    const payments = await Payment.find({ debtId: ctx.debt._id });
    expect(payments[0].amount).toBe(100000);
  });
});

describe("money that arrives with nothing owed", () => {
  it("is recorded as unattributed, never discarded (LW-002)", async () => {
    const ctx = await anInvoice(100000);
    const pa = await anAddressFor(ctx, { index: 5 });

    // The invoice is already settled by other means — a bank transfer, say.
    await Payment.create({
      debtId: ctx.debt._id,
      userId: ctx.user._id,
      amount: 100000,
      method: "transfer",
      txHash: `manual:${ctx.user._id}:paid-in-full`,
    });
    await recomputeDebtStatus(await Debt.findById(ctx.debt._id));

    aConfirmedTransfer(pa, 15);
    await pa.save();

    const result = await settleIfDue(pa, CHAIN);
    expect(result.outcome).toBe("UNATTRIBUTED");

    const after = await PaymentAddress.findById(pa._id);
    expect(after.unattributedUsdc).toBeCloseTo(15, 2);
    expect(after.unattributedAt).toBeTruthy();
    // Assigned, not accumulated: running the pass again must converge, not drift.
    await settleIfDue(await PaymentAddress.findById(pa._id), CHAIN);
    const again = await PaymentAddress.findById(pa._id);
    expect(again.unattributedUsdc).toBeCloseTo(15, 2);
  });
});

describe("the repair path", () => {
  it("re-stamps a transfer whose Payment exists but whose stamp did not persist", async () => {
    /**
     * The state that used to become a double credit: `Payment.create` succeeded
     * and the `pa.save()` that records `settledPaymentId` did not. On the next
     * pass the same hash hit the unique index and returned safely — but the
     * moment a NEW transfer arrived the key was new, the insert succeeded, and
     * every earlier transfer was credited a second time.
     */
    const ctx = await anInvoice(100000);
    const pa = await anAddressFor(ctx, { index: 6 });
    aConfirmedTransfer(pa, 40);
    await pa.save();

    await settleIfDue(pa, CHAIN);

    // Simulate the lost save: the Payment stays, the stamp is wiped.
    const damaged = await PaymentAddress.findById(pa._id);
    damaged.observed.forEach((o) => {
      o.settledPaymentId = null;
    });
    await damaged.save();

    // A second transfer arrives.
    const withMore = await PaymentAddress.findById(pa._id);
    aConfirmedTransfer(withMore, 22.5);
    await withMore.save();

    await settleIfDue(await PaymentAddress.findById(pa._id), CHAIN);

    const payments = await Payment.find({ debtId: ctx.debt._id });
    // Two transfers, two credits, summing to the invoice. NOT three.
    expect(payments.reduce((s, p) => s + p.amount, 0)).toBe(100000);
    const restamped = await PaymentAddress.findById(pa._id);
    expect(restamped.observed.every((o) => o.settledPaymentId)).toBe(true);
  });
});

describe("deleting a crypto payment", () => {
  it("releases the transfers it covered so they can be credited again (A2-02)", async () => {
    /**
     * Deleting the Payment on its own left `settledPaymentId` pointing at a row
     * that no longer existed. `settleIfDue` reads those stamps as "already
     * settled", so the invoice reopened, was re-quoted UPWARDS, and the money
     * sitting confirmed at the address could never be credited again — while the
     * customer was chased for it a second time.
     */
    const ctx = await anInvoice(100000);
    const pa = await anAddressFor(ctx, { index: 7 });
    aConfirmedTransfer(pa, 62.5);
    await pa.save();
    await settleIfDue(pa, CHAIN);

    const payment = await Payment.findOne({ debtId: ctx.debt._id });
    expect(payment).toBeTruthy();

    // What the controller now does before deleting.
    const covered = [...(payment.txHashes || []), payment.txHash].filter(Boolean);
    const held = await PaymentAddress.findOne({
      debtId: ctx.debt._id,
      "observed.txHash": { $in: covered },
    });
    let released = 0;
    held.observed.forEach((o) => {
      if (o.settledPaymentId && String(o.settledPaymentId) === String(payment._id)) {
        o.settledPaymentId = null;
        released++;
      }
    });
    held.settledNgn = Math.max(0, (held.settledNgn || 0) - payment.amount);
    if (held.status === "paid") held.status = "active";
    await held.save();
    await payment.deleteOne();

    expect(released).toBe(1);

    await recomputeDebtStatus(await Debt.findById(ctx.debt._id));
    await resyncActivePaymentAddress(ctx.debt._id);

    // The money is creditable again on the very next pass.
    const reopened = await PaymentAddress.findById(pa._id);
    const result = await settleIfDue(reopened, CHAIN);
    expect(result).toBeTruthy();
    expect(result.fullyPaid).toBe(true);
    expect(await Payment.countDocuments({ debtId: ctx.debt._id })).toBe(1);
  });
});
