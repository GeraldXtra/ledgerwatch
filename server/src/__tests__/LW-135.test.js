process.env.SMTP_HOST = "";
process.env.VAPID_PRIVATE_KEY = "";
process.env.ANTHROPIC_API_KEY = "";

const Debt = require("../models/Debt");
const Payment = require("../models/Payment");
const PaymentAddress = require("../models/PaymentAddress");
const User = require("../models/User");
const money = require("../domain/money");
const { settleIfDue, toleratedShortfallUnits } = require("../services/paymentWatch.service");
const { usdcForKobo } = require("../services/paymentAddress.service");
const { attachTotals, recomputeDebtStatus } = require("../services/receivables.service");
const { backfillMoney } = require("../scripts/backfill-money-kobo");

const CHAIN = { chainId: 84532, name: "Base Sepolia" };

function lcg(seed) {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return x;
  };
}

let seq = 0;
const nextHash = () => `0x${(++seq).toString(16).padStart(64, "0")}`;

async function anOwner() {
  return User.create({ name: "Kobo", email: `kobo-${Date.now()}-${++seq}@example.com`, passwordHash: "x" });
}

describe("LW-135 — money is whole kobo and whole base units", () => {
  it("round-trips every kobo amount through naira and display without drift", () => {
    const rand = lcg(42);
    for (let i = 0; i < 5000; i++) {
      const kobo = rand() % 1000000000000;
      const naira = money.koboToNaira(kobo);
      expect(money.nairaToKobo(naira)).toBe(kobo);
      expect(money.hasWholeKobo(naira)).toBe(true);
      const shown = naira.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      expect(money.nairaToKobo(Number(shown.replace(/,/g, "")))).toBe(kobo);
    }
  });

  it("sums kobo exactly where floating point does not", () => {
    const payments = [{ amount: 0.1 }, { amount: 0.7 }];
    expect(payments.reduce((s, p) => s + p.amount, 0)).not.toBe(0.8);
    expect(money.sumKobo(payments)).toBe(80);
    expect(money.sumKobo([{ amountKobo: 5, amount: 999 }])).toBe(5);
  });

  it("refuses amounts that are not whole kobo, and anything that is not a number", () => {
    expect(money.hasWholeKobo(1500.5)).toBe(true);
    expect(money.hasWholeKobo(1500.505)).toBe(false);
    expect(() => money.nairaToKobo("abc")).toThrow(/not a number/);
    expect(() => money.nairaToKobo(Number.MAX_VALUE)).toThrow(/too large/);
  });

  it("converts decimals to base units exactly, both ways", () => {
    const rand = lcg(7);
    for (let i = 0; i < 2000; i++) {
      const units = BigInt(rand()) * 1000003n + BigInt(rand() % 1000);
      for (const decimals of [0, 2, 6, 8, 18]) {
        const text = money.unitsToDecimalString(units, decimals);
        expect(money.decimalToUnits(text, decimals)).toBe(units);
      }
    }
    expect(money.decimalToUnits("0.1234565", 6)).toBe(123457n);
    expect(money.decimalToUnits(12.34, 6)).toBe(12340000n);
    expect(money.toUnits("0x0f4240")).toBe(1000000n);
    expect(() => money.toUnits("1.5")).toThrow(/whole number/);
  });

  it("always asks for enough stablecoin to cover the invoice", () => {
    const rand = lcg(99);
    for (let i = 0; i < 3000; i++) {
      const kobo = 1 + (rand() % 500000000);
      const rate = 800 + (rand() % 200000) / 100;
      const expected = usdcForKobo(kobo, rate);
      const units = money.decimalToUnits(expected, 6);
      expect(money.unitsToKobo(units, 6, rate)).toBeGreaterThanOrEqual(kobo);
      expect(money.unitsToKobo(units - 10000n, 6, rate)).toBeLessThan(kobo + 1);
    }
  });

  it("tolerates a shortfall that is capped in base units", () => {
    expect(toleratedShortfallUnits(7350000n, 6)).toBe(36750n);
    expect(toleratedShortfallUnits(240058820000n, 6)).toBe(50000n);
  });

  it("settles a crypto payment in whole kobo and records it on the address", async () => {
    const user = await anOwner();
    const debt = await Debt.create({ userId: user._id, debtorName: "Exact", amount: 100000.01, amountKobo: 10000001, dueDate: new Date() });
    const pa = await PaymentAddress.create({
      userId: user._id,
      debtId: debt._id,
      chainId: CHAIN.chainId,
      derivationIndex: 0,
      address: `0x${"b".repeat(40)}`,
      tokenSymbol: "USDC",
      tokenContract: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      tokenDecimals: 6,
      invoiceBalanceNgn: 100000.01,
      expectedUsdc: usdcForKobo(10000001, 1600),
      ngnPerUsd: 1600,
      rateTimestamp: new Date(),
      status: "active",
      expiresAt: new Date(Date.now() + 3600 * 1000),
    });
    expect(pa.expectedUsdc).toBe(62.51);
    for (const part of ["30000000", "20000000", "12510000"]) {
      pa.observed.push({ txHash: nextHash(), from: `0x${"d".repeat(40)}`, value: part, blockNumber: seq, status: "confirmed", confirmedAt: new Date() });
    }
    await pa.save();

    const result = await settleIfDue(pa, CHAIN);
    expect(result.fullyPaid).toBe(true);
    const payment = await Payment.findOne({ debtId: debt._id }).lean();
    expect(payment.amountKobo).toBe(10000001);
    expect(payment.amount).toBe(100000.01);
    const after = await PaymentAddress.findById(pa._id).lean();
    expect(after.settledKobo).toBe(10000001);
    expect(after.status).toBe("paid");
    const [derived] = await attachTotals(user._id, [await Debt.findById(debt._id)]);
    expect(derived).toMatchObject({ amountKobo: 10000001, amountPaidKobo: 10000001, balanceKobo: 0, displayStatus: "paid" });
  });

  it("decides a part payment against what is owed in kobo, ignoring float noise", async () => {
    const user = await anOwner();
    const debt = await Debt.create({ userId: user._id, debtorName: "Parts", amount: 0.3, amountKobo: 30, dueDate: new Date(Date.now() + 86400000) });
    await Payment.create({ userId: user._id, debtId: debt._id, amount: 0.1, amountKobo: 10 });
    await Payment.create({ userId: user._id, debtId: debt._id, amount: 0.2, amountKobo: 20 });
    await recomputeDebtStatus(debt);
    expect(debt.status).toBe("paid");
  });

  it("reads rows written before the kobo field existed", async () => {
    const user = await anOwner();
    const debt = await Debt.create({ userId: user._id, debtorName: "Legacy", amount: 2500.5, dueDate: new Date(Date.now() + 86400000) });
    await Payment.create({ userId: user._id, debtId: debt._id, amount: 1000.25 });
    const [derived] = await attachTotals(user._id, [debt]);
    expect(derived).toMatchObject({ amountKobo: 250050, amountPaidKobo: 100025, balanceKobo: 150025, balance: 1500.25 });
  });
});

describe("LW-135 — the kobo backfill previews, applies and rolls back", () => {
  beforeEach(async () => {
    await Promise.all([Debt.deleteMany({}), Payment.deleteMany({}), PaymentAddress.deleteMany({})]);
  });

  it("writes nothing in a preview, then fills only the missing fields, and can be undone", async () => {
    const user = await anOwner();
    const legacy = await Debt.collection.insertOne({ userId: user._id, debtorName: "Old", amount: 1234.56, dueDate: new Date(), status: "pending" });
    await Payment.collection.insertOne({ userId: user._id, debtId: legacy.insertedId, amount: 34.56, paidAt: new Date() });
    await Debt.create({ userId: user._id, debtorName: "New", amount: 10, amountKobo: 1000, dueDate: new Date() });

    const preview = await backfillMoney();
    expect(preview.find((r) => r.name === "invoices")).toMatchObject({ total: 2, missing: 1, written: 0 });
    expect(await Debt.countDocuments({ amountKobo: { $exists: true } })).toBe(1);

    const applied = await backfillMoney({ apply: true });
    expect(applied.find((r) => r.name === "invoices")).toMatchObject({ written: 1 });
    expect(applied.find((r) => r.name === "payments")).toMatchObject({ written: 1 });
    expect((await Debt.findById(legacy.insertedId).lean()).amountKobo).toBe(123456);

    const again = await backfillMoney({ apply: true });
    expect(again.every((r) => r.written === 0)).toBe(true);

    await backfillMoney({ apply: true, rollback: true });
    expect(await Debt.countDocuments({ amountKobo: { $exists: true } })).toBe(0);
    expect(await Payment.countDocuments({ amountKobo: { $exists: true } })).toBe(0);
  });

  it("reports an amount that is not whole kobo, and a stored kobo value that disagrees", async () => {
    const user = await anOwner();
    await Debt.collection.insertOne({ userId: user._id, debtorName: "Fraction", amount: 10.005, dueDate: new Date() });
    await Debt.collection.insertOne({ userId: user._id, debtorName: "Drift", amount: 10, amountKobo: 999, dueDate: new Date() });
    const [invoices] = await backfillMoney();
    expect(invoices.fractional).toHaveLength(1);
    expect(invoices.drifted).toEqual([expect.objectContaining({ stored: 999, expected: 1000 })]);
  });
});
