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
    const ctx = await anInvoice(100000);
    const pa = await anAddressFor(ctx);
    expect(pa.expectedUsdc).toBe(62.5);

    aConfirmedTransfer(pa, 62.5);
    await pa.save();

    const result = await settleIfDue(pa, CHAIN);

    expect(result).toBeTruthy();
    expect(result.fullyPaid).toBe(true);

    const payments = await Payment.find({ debtId: ctx.debt._id });
    expect(payments).toHaveLength(1);
    expect(payments[0].amount).toBe(100000);
    expect(payments[0].method).toBe("crypto");

    const after = await PaymentAddress.findById(pa._id);
    expect(after.status).toBe("paid");
    expect(after.observed.every((o) => o.settledPaymentId)).toBe(true);
  });

  it("is idempotent: a second pass over the same address changes nothing", async () => {
    const ctx = await anInvoice(100000);
    const pa = await anAddressFor(ctx, { index: 1 });
    aConfirmedTransfer(pa, 62.5);
    await pa.save();

    await settleIfDue(pa, CHAIN);
    const second = await settleIfDue(await PaymentAddress.findById(pa._id), CHAIN);

    expect(second).toEqual({ outcome: "NOTHING_NEW" });
    expect(await Payment.countDocuments({ debtId: ctx.debt._id })).toBe(1);
  });
});

describe("an invoice paid in two parts", () => {
  it("credits each part once and leaves the right balance in between", async () => {
    const ctx = await anInvoice(100000);
    const pa = await anAddressFor(ctx, { index: 2 });

    aConfirmedTransfer(pa, 40);
    await pa.save();
    const first = await settleIfDue(pa, CHAIN);

    expect(first.fullyPaid).toBe(false);
    expect(first.creditNgn).toBe(40 * NGN_PER_USD);

    let debt = await Debt.findById(ctx.debt._id);
    expect(debt.status).toBe("partially_paid");

    const resynced = await PaymentAddress.findById(pa._id);
    expect(resynced.expectedUsdc).toBeCloseTo(22.5, 2);

    aConfirmedTransfer(resynced, 22.5);
    await resynced.save();
    const second = await settleIfDue(resynced, CHAIN);

    expect(second.fullyPaid).toBe(true);

    const payments = await Payment.find({ debtId: ctx.debt._id }).sort({ createdAt: 1 });
    expect(payments).toHaveLength(2);
    expect(payments.reduce((s, p) => s + p.amount, 0)).toBe(100000);

    debt = await Debt.findById(ctx.debt._id);
    expect(debt.status).toBe("paid");
  });

  it("the panel's own figure agrees with the ledger after a part payment", async () => {
    const ctx = await anInvoice(100000);
    const pa = await anAddressFor(ctx, { index: 3 });
    aConfirmedTransfer(pa, 40);
    await pa.save();
    await settleIfDue(pa, CHAIN);

    const after = await PaymentAddress.findById(pa._id);

    const wrong = Math.max(0, after.expectedUsdc - after.receivedUsdc);
    expect(wrong).toBe(0);

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
    aConfirmedTransfer(pa, 70);
    await pa.save();

    const result = await settleIfDue(pa, CHAIN);
    expect(result.fullyPaid).toBe(true);

    const after = await PaymentAddress.findById(pa._id);
    expect(after.overpaidUsdc).toBeCloseTo(7.5, 2);

    const payments = await Payment.find({ debtId: ctx.debt._id });
    expect(payments[0].amount).toBe(100000);
  });
});

describe("money that arrives with nothing owed", () => {
  it("is recorded as unattributed, never discarded (LW-002)", async () => {
    const ctx = await anInvoice(100000);
    const pa = await anAddressFor(ctx, { index: 5 });

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
    await settleIfDue(await PaymentAddress.findById(pa._id), CHAIN);
    const again = await PaymentAddress.findById(pa._id);
    expect(again.unattributedUsdc).toBeCloseTo(15, 2);
  });
});

describe("the repair path", () => {
  it("re-stamps a transfer whose Payment exists but whose stamp did not persist", async () => {
    const ctx = await anInvoice(100000);
    const pa = await anAddressFor(ctx, { index: 6 });
    aConfirmedTransfer(pa, 40);
    await pa.save();

    await settleIfDue(pa, CHAIN);

    const damaged = await PaymentAddress.findById(pa._id);
    damaged.observed.forEach((o) => {
      o.settledPaymentId = null;
    });
    await damaged.save();

    const withMore = await PaymentAddress.findById(pa._id);
    aConfirmedTransfer(withMore, 22.5);
    await withMore.save();

    await settleIfDue(await PaymentAddress.findById(pa._id), CHAIN);

    const payments = await Payment.find({ debtId: ctx.debt._id });
    expect(payments.reduce((s, p) => s + p.amount, 0)).toBe(100000);
    const restamped = await PaymentAddress.findById(pa._id);
    expect(restamped.observed.every((o) => o.settledPaymentId)).toBe(true);
  });
});

describe("deleting a crypto payment", () => {
  it("releases the transfers it covered so they can be credited again (A2-02)", async () => {
    const ctx = await anInvoice(100000);
    const pa = await anAddressFor(ctx, { index: 7 });
    aConfirmedTransfer(pa, 62.5);
    await pa.save();
    await settleIfDue(pa, CHAIN);

    const payment = await Payment.findOne({ debtId: ctx.debt._id });
    expect(payment).toBeTruthy();

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

    const reopened = await PaymentAddress.findById(pa._id);
    const result = await settleIfDue(reopened, CHAIN);
    expect(result).toBeTruthy();
    expect(result.fullyPaid).toBe(true);
    expect(await Payment.countDocuments({ debtId: ctx.debt._id })).toBe(1);
  });
});
