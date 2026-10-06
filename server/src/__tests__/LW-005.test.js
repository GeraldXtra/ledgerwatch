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

    expect(after.expectedUsdc).toBeCloseTo(22.5, 2);
    expect(after.invoiceBalanceNgn).toBe(36000);

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

    expect(after.status).toBe("paid");
    expect(after.expectedUsdc).toBe(0);

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
    expect(after.expectedUsdc).toBeCloseTo(43.75, 2);
    expect(after.quote.expectedUsdc).toBe(quoted);
  });

  it("keeps the two figures genuinely separate in the schema", async () => {
    const { pa } = await anInvoiceWithAddress(80000);
    const doc = await PaymentAddress.findById(pa._id);

    doc.expectedUsdc = 1;
    await doc.save();

    const after = await PaymentAddress.findById(pa._id);
    expect(after.expectedUsdc).toBe(1);
    expect(after.quote.expectedUsdc).toBe(50);
  });

  it("marks a reconstructed quote as such, so it is never mistaken for a record", async () => {
    const { pa } = await anInvoiceWithAddress(100000);
    const doc = await PaymentAddress.findById(pa._id);
    doc.quote.reconstructed = true;
    await doc.save();

    const after = await PaymentAddress.findById(pa._id);
    expect(after.quote.reconstructed).toBe(true);
  });
});
