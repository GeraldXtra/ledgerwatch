/**
 * LW-002 — money that arrives when nothing is owed must still be recorded.
 *
 * THE DEFECT. `settleIfDue` opened with `if (remainingNgn <= 0) return null;`
 * before Payment.create, before receivedUsdc was updated, before status was set
 * and before save. A confirmed on chain transfer therefore left no trace of any
 * kind: not a payment, not a note, not a flag on the address.
 *
 * THIS WAS LIVE. PaymentAddress derivationIndex 16 in the development database
 * holds a confirmed transfer of 7.35 USDC at 131 confirmations, sweeps: 1,
 * receivedUsdc: 0, settledPaymentId: null, and there is no Payment row for its
 * hash anywhere. Somebody paid, the chain confirmed it, the funds were swept to
 * the owner's wallet, and the ledger has no memory of it.
 *
 * The rule this restores is ARCHITECTURE.md section 4.4: value that arrives is
 * credited, recorded as overpayment, or recorded as unattributed. There is no
 * fourth outcome and no path that returns without choosing one.
 */

// Blank every outbound integration BEFORE anything is required.
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

/** An invoice that is already settled in full, with a late transfer arriving. */
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

  // Closed by a manual entry, exactly as the live case was.
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
    // Required by the schema. Long expired, which is the state each scenario needs.
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

    // The whole point: an outcome, not silence.
    expect(result).toBeTruthy();
    expect(result.outcome).toBe("UNATTRIBUTED");
    expect(result.unattributedUsdc).toBeCloseTo(7.35, 2);

    const after = await PaymentAddress.findById(pa._id).lean();
    expect(after.unattributedUsdc).toBeCloseTo(7.35, 2);
    expect(after.unattributedAt).toBeTruthy();

    // Durably recorded on the address, so the amount survives a restart.
    expect(after.receivedUsdc).toBeCloseTo(7.35, 2);

    // And surfaced through the field the invoice panel already renders, rather
    // than living only in a log line.
    expect(after.unidentifiedBalanceAt).toBeTruthy();
  });

  it("does NOT invent a Payment for an invoice that owes nothing", async () => {
    const { debt, pa } = await scenarioAlreadySettled();

    await settleIfDue(pa, CHAIN);

    // Still exactly the one manual payment that closed it. Crediting again would
    // overpay the invoice and misstate the owner's collected figure.
    const payments = await Payment.find({ debtId: debt._id }).lean();
    expect(payments).toHaveLength(1);
    expect(payments[0].method).toBe("other");
  });

  it("accumulates rather than overwriting when a second one arrives", async () => {
    const { pa } = await scenarioAlreadySettled();

    await settleIfDue(pa, CHAIN);

    // A second late transfer to the same dead address.
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
    // 7.35 then 2.50 is 9.85 held at this address, and the figure must be that
    // after any number of passes. The first version of the fix ADDED the running
    // total on each pass and this read 17.20, counting the first transfer twice.
    // The branch runs on every grace scan for thirty days, so drift here is not
    // a rounding nuisance, it is a number the owner would act on.
    expect(after.unattributedUsdc).toBeCloseTo(9.85, 2);
  });
});
