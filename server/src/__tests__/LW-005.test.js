/**
 * LW-005 — the issuance quote must survive everything that changes the balance.
 *
 * THE DEFECT. A payment address stored ONE set of figures, and
 * `resyncActivePaymentAddress` assigned over them after every partial
 * settlement and every edit to the invoice. So the record of what the payer was
 * actually ASKED to send was destroyed by the first thing that changed what was
 * owed.
 *
 * Why that matters more than it sounds. A payer is told "send exactly 62.50
 * USDC". They send it. In between, a bank transfer settles part of the same
 * invoice, resync rewrites the expectation to 22.50, and the only question that
 * matters in a dispute — did this person send what they were told to send? —
 * has no answer anywhere. 62.50 against a 22.50 expectation reads as a 40 USDC
 * overpayment when in fact they paid exactly what the invoice asked.
 *
 * `ARCHITECTURE.md` invariant 6 states the rule: "PaymentAddress.quote.* is
 * immutable after issuance". `BUILD_PLAN.md` P1-1 is the task. This is the test.
 */

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
const { resyncActivePaymentAddress } = require("../services/paymentAddress.service");

const NGN_PER_USD = 1600;
let seq = 0;

async function anInvoiceWithAddress(amountNgn) {
  const user = await User.create({
    name: "Owner",
    email: `owner-lw005-${Date.now()}-${++seq}@example.com`,
    passwordHash: "not-a-real-hash",
  });
  const debt = await Debt.create({
    userId: user._id,
    debtorName: "Zenith Trading",
    amount: amountNgn,
    dueDate: new Date(),
  });

  const expectedUsdc = Math.ceil((amountNgn / NGN_PER_USD) * 100) / 100;
  const pa = await PaymentAddress.create({
    userId: user._id,
    debtId: debt._id,
    chainId: 84532,
    derivationIndex: seq,
    address: `0x${String(seq).padStart(40, "e")}`,
    tokenSymbol: "USDC",
    tokenContract: `0x${"c".repeat(40)}`,
    tokenDecimals: 6,
    invoiceBalanceNgn: amountNgn,
    expectedUsdc,
    ngnPerUsd: NGN_PER_USD,
    rateTimestamp: new Date(),
    status: "active",
    expiresAt: new Date(Date.now() + 72 * 3600 * 1000),
    // Written exactly as `issueAddress` writes it.
    quote: {
      invoiceBalanceNgn: amountNgn,
      expectedUsdc,
      ngnPerUsd: NGN_PER_USD,
      rateTimestamp: new Date(),
      rateIsFallback: false,
      issuedAt: new Date(),
      reconstructed: false,
    },
  });
  return { user, debt, pa, expectedUsdc };
}

describe("the issuance quote is immutable", () => {
  it("survives a partial settlement that rewrites what is still expected", async () => {
    const { user, debt, pa, expectedUsdc } = await anInvoiceWithAddress(100000);
    expect(expectedUsdc).toBe(62.5);

    // A bank transfer settles part of the same invoice.
    await Payment.create({
      debtId: debt._id,
      userId: user._id,
      amount: 64000,
      method: "transfer",
      txHash: `manual:${user._id}:part`,
    });

    const result = await resyncActivePaymentAddress(debt._id);
    expect(result.updated).toBe(true);

    const after = await PaymentAddress.findById(pa._id);

    // The EXPECTATION moved, which is correct and is what settlement compares
    // against (LW-004).
    expect(after.expectedUsdc).toBeCloseTo(22.5, 2);
    expect(after.invoiceBalanceNgn).toBe(36000);

    // The QUOTE did not. This is the assertion the defect was about.
    expect(after.quote.expectedUsdc).toBe(62.5);
    expect(after.quote.invoiceBalanceNgn).toBe(100000);
    expect(after.quote.ngnPerUsd).toBe(NGN_PER_USD);
    expect(after.quote.reconstructed).toBe(false);
  });

  it("survives the invoice being closed to `paid`", async () => {
    const { user, debt, pa } = await anInvoiceWithAddress(50000);

    await Payment.create({
      debtId: debt._id,
      userId: user._id,
      amount: 50000,
      method: "transfer",
      txHash: `manual:${user._id}:full`,
    });

    await resyncActivePaymentAddress(debt._id);
    const after = await PaymentAddress.findById(pa._id);

    // Closed: nothing more is expected of this address.
    expect(after.status).toBe("paid");
    expect(after.expectedUsdc).toBe(0);

    // But what the payer was asked for is unchanged. Whoever ended up paying it,
    // this address was issued for 31.25 and that remains true.
    expect(after.quote.expectedUsdc).toBe(31.25);
    expect(after.quote.invoiceBalanceNgn).toBe(50000);
  });

  it("survives repeated resyncs", async () => {
    const { user, debt, pa } = await anInvoiceWithAddress(100000);
    const quoted = (await PaymentAddress.findById(pa._id)).quote.expectedUsdc;

    for (const amount of [10000, 10000, 10000]) {
      await Payment.create({
        debtId: debt._id,
        userId: user._id,
        amount,
        method: "transfer",
        txHash: `manual:${user._id}:${Math.random().toString(36).slice(2)}`,
      });
      await resyncActivePaymentAddress(debt._id);
    }

    const after = await PaymentAddress.findById(pa._id);
    expect(after.expectedUsdc).toBeCloseTo(43.75, 2); // (100000 - 30000) / 1600
    expect(after.quote.expectedUsdc).toBe(quoted); // untouched, three times over
  });

  it("keeps the two figures genuinely separate in the schema", async () => {
    // A guard against somebody "simplifying" the model by pointing one at the
    // other. They are different quantities and must be different fields.
    const { pa } = await anInvoiceWithAddress(80000);
    const doc = await PaymentAddress.findById(pa._id);

    doc.expectedUsdc = 1;
    await doc.save();

    const after = await PaymentAddress.findById(pa._id);
    expect(after.expectedUsdc).toBe(1);
    expect(after.quote.expectedUsdc).toBe(50); // 80000 / 1600
  });

  it("marks a reconstructed quote as such, so it is never mistaken for a record", async () => {
    // What `backfill-issuance-quote.js` writes for a row whose original figures
    // were already overwritten. The flag is the whole point: those numbers are a
    // reasonable guess and must not settle a dispute silently.
    const { pa } = await anInvoiceWithAddress(100000);
    const doc = await PaymentAddress.findById(pa._id);
    doc.quote.reconstructed = true;
    await doc.save();

    const after = await PaymentAddress.findById(pa._id);
    expect(after.quote.reconstructed).toBe(true);
  });
});
