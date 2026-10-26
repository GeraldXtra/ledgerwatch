process.env.JWT_SECRET = process.env.JWT_SECRET || "lw-152-invoice-seq-tests-0123456789abcdef";
process.env.SMTP_HOST = "";
process.env.ANTHROPIC_API_KEY = "";
process.env.CLIENT_URL = "https://www.useledgerwatch.co";

const mongoose = require("mongoose");
const app = require("../app");
const User = require("../models/User");
const Debt = require("../models/Debt");
const signToken = require("../utils/token");
const { nextInvoiceNumber, withInvoiceNumber, ensureInvoiceNumber } = require("../services/invoice.service");
const { backfillInvoiceNumbers } = require("../scripts/backfill-invoice-numbers");

let server;
let base;
let seq = 0;

beforeAll(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
  await Debt.init();
  await User.init();
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function call(method, path, { token, body } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

function rawDebt(userId, i, extra = {}) {
  return {
    userId,
    debtorName: `Debtor ${i}`,
    debtorEmail: `d${i}@client.example`,
    amount: 1000 * (i + 1),
    amountKobo: 100000 * (i + 1),
    currency: "NGN",
    dueDate: new Date(Date.now() - 10 * 86400000),
    status: "pending",
    reminderCadenceDays: 3,
    history: [],
    createdAt: new Date(Date.now() - 1000 * (10 - i)),
    ...extra,
  };
}

async function launchAccount({ numbered }) {
  const id = new mongoose.Types.ObjectId();
  await User.collection.insertOne({
    _id: id,
    name: "Launch",
    companyName: "Launch Ltd",
    email: `launch-${id}-${++seq}@example.com`,
    passwordHash: "x",
    emailVerified: true,
    tokenVersion: 0,
    autoSend: { enabled: false },
    crypto: { enabled: true, nextDerivationIndex: 0 },
    createdAt: new Date("2026-07-22"),
  });
  const ids = [];
  for (let i = 0; i < numbered; i++) {
    const r = await Debt.collection.insertOne(rawDebt(id, i, { invoiceNumber: `INV-${String(i + 1).padStart(4, "0")}` }));
    ids.push(r.insertedId);
  }
  return { id, ids, token: signToken(id, 0) };
}

describe("LW-152 — the counter behind invoice numbers must never sit below the numbers in use", () => {
  it("the production backfill left invoiceSeq unset: a $lt match on a missing field writes nothing", async () => {
    const { id } = await launchAccount({ numbered: 0 });
    const res = await User.updateOne({ _id: id, invoiceSeq: { $lt: 3 } }, { $set: { invoiceSeq: 3 } });
    expect(res.matchedCount).toBe(0);
    expect((await User.collection.findOne({ _id: id })).invoiceSeq).toBeUndefined();
  });

  it("in that state the next number is INV-0001 again, which the unique index refuses", async () => {
    const { id } = await launchAccount({ numbered: 3 });
    expect(await nextInvoiceNumber(id)).toBe("INV-0001");
    await expect(Debt.create(rawDebt(id, 9, { invoiceNumber: "INV-0001" }))).rejects.toMatchObject({ code: 11000 });
  });

  it("numbering moves the counter past the highest number in use and succeeds", async () => {
    const { id } = await launchAccount({ numbered: 3 });
    const tried = [];
    const written = await withInvoiceNumber(id, async (n) => {
      tried.push(n);
      return Debt.create(rawDebt(id, 8, { invoiceNumber: n }));
    });
    expect(tried).toEqual(["INV-0001", "INV-0004"]);
    expect(written.invoiceNumber).toBe("INV-0004");
    expect((await User.collection.findOne({ _id: id })).invoiceSeq).toBe(4);
    expect(await nextInvoiceNumber(id)).toBe("INV-0005");
  });

  it("a new invoice in a launch account is created and numbered after the existing ones", async () => {
    const { id, token } = await launchAccount({ numbered: 3 });
    const res = await call("POST", "/api/debts", {
      token,
      body: { debtorName: "Fresh Stores", debtorPhone: "08031234567", amount: "7500", dueDate: "2026-10-01", note: "", reminderCadenceDays: "3" },
    });
    expect(res.status).toBe(201);
    expect(res.body.debt.invoiceNumber).toBe("INV-0004");
    const again = await call("POST", "/api/debts", { token, body: { debtorName: "Second", amount: 100, dueDate: "2026-10-02" } });
    expect(again.status).toBe(201);
    expect(again.body.debt.invoiceNumber).toBe("INV-0005");
    expect(await Debt.countDocuments({ userId: id })).toBe(5);
  });

  it("an unnumbered invoice from before the launch is given the next free number, and a reminder for it works", async () => {
    const { id, token } = await launchAccount({ numbered: 2 });
    const old = await Debt.collection.insertOne(rawDebt(id, 7));
    const debt = await Debt.findById(old.insertedId);
    expect(await ensureInvoiceNumber(debt)).toBe("INV-0003");
    const remind = await call("POST", `/api/debts/${old.insertedId}/remind`, { token, body: {} });
    expect(remind.status).toBe(201);
    expect(remind.body.messageText).toMatch(/INV-0003/);
  });

  it("the backfill script now sets the counter even when the account never had one", async () => {
    const { id } = await launchAccount({ numbered: 0 });
    await Debt.collection.insertOne(rawDebt(id, 0));
    await Debt.collection.insertOne(rawDebt(id, 1));
    const report = await backfillInvoiceNumbers({ apply: true });
    expect(report.find((r) => r.userId === String(id))).toMatchObject({ missing: 2, first: "INV-0001", last: "INV-0002", written: 2 });
    expect((await User.collection.findOne({ _id: id })).invoiceSeq).toBe(2);
    expect(await nextInvoiceNumber(id)).toBe("INV-0003");
  });
});
