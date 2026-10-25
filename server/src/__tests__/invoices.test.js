process.env.JWT_SECRET = process.env.JWT_SECRET || "lw-invoice-tests-only-0123456789abcdefghijk";
process.env.SMTP_HOST = "";
process.env.ANTHROPIC_API_KEY = "";
process.env.CLIENT_URL = "https://www.useledgerwatch.co";

const app = require("../app");
const User = require("../models/User");
const Debt = require("../models/Debt");
const Payment = require("../models/Payment");
const signToken = require("../utils/token");
const { generateReminderForDebt } = require("../services/reminder.service");

let server;
let base;
let seq = 0;

beforeAll(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function owner(extra = {}) {
  const user = await User.create({
    name: "Ada",
    companyName: "Ada Fabrics",
    email: `inv-${Date.now()}-${++seq}@example.com`,
    passwordHash: "x",
    emailVerified: true,
    bankDetails: { bankName: "Zenith Bank", accountName: "Ada Fabrics Ltd", accountNumber: "1234567890" },
    ...extra,
  });
  return { user, token: signToken(user._id, user.tokenVersion) };
}

async function call(method, path, { token, body } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const type = res.headers.get("content-type") || "";
  return {
    status: res.status,
    headers: res.headers,
    body: type.includes("application/json") ? await res.json() : Buffer.from(await res.arrayBuffer()),
  };
}

async function anInvoice(token, amount = 25000) {
  const res = await call("POST", "/api/debts", { token, body: { debtorName: "Bola Stores", amount, dueDate: "2031-01-15", note: "Ankara, 10 bales" } });
  expect(res.status).toBe(201);
  return res.body.debt;
}

describe("invoice numbers", () => {
  it("numbers each account's invoices from INV-0001, independently of other accounts", async () => {
    const a = await owner();
    const b = await owner();
    expect((await anInvoice(a.token)).invoiceNumber).toBe("INV-0001");
    expect((await anInvoice(a.token)).invoiceNumber).toBe("INV-0002");
    expect((await anInvoice(b.token)).invoiceNumber).toBe("INV-0001");
  });

  it("gives an invoice created before numbering existed a number when it is first shared", async () => {
    const a = await owner();
    await anInvoice(a.token);
    const legacy = await Debt.create({ userId: a.user._id, debtorName: "Old", amount: 10, amountKobo: 1000, dueDate: new Date() });
    const shared = await call("POST", `/api/debts/${legacy._id}/share`, { token: a.token, body: {} });
    expect(shared.status).toBe(200);
    expect(shared.body.invoiceNumber).toBe("INV-0002");
  });
});

describe("amounts too large to hold exactly", () => {
  it("are refused with a clear message instead of failing on the server", async () => {
    const a = await owner();
    const huge = await call("POST", "/api/debts", {
      token: a.token,
      body: { debtorName: "Bola Stores", amount: 1e15, dueDate: "2031-01-15" },
    });
    expect(huge.status).toBe(400);
    expect(huge.body.error).toMatch(/at most 1,000,000,000,000/);
    const debt = await anInvoice(a.token);
    const payment = await call("POST", `/api/debts/${debt._id}/payments`, {
      token: a.token,
      body: { amount: 1e15, idempotencyKey: "huge-payment-01" },
    });
    expect(payment.status).toBe(400);
    expect(payment.body.error).toMatch(/at most 1,000,000,000,000/);
  });
});

describe("invoice PDF", () => {
  it("downloads a PDF named after the invoice", async () => {
    const a = await owner();
    const debt = await anInvoice(a.token);
    const res = await call("GET", `/api/debts/${debt._id}/invoice.pdf`, { token: a.token });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toContain('filename="INV-0001.pdf"');
    expect(res.body.subarray(0, 5).toString()).toBe("%PDF-");
    expect(res.body.length).toBeGreaterThan(5000);
  });

  it("will not hand one account another account's invoice", async () => {
    const a = await owner();
    const b = await owner();
    const debt = await anInvoice(b.token);
    expect((await call("GET", `/api/debts/${debt._id}/invoice.pdf`, { token: a.token })).status).toBe(404);
  });

  it("lets a long note run on to the next page instead of printing over the totals (LW-145)", async () => {
    const { buildInvoicePdf } = require("../services/invoice.service");
    const view = {
      businessName: "Ada Fabrics",
      invoiceNumber: "INV-0001",
      debtorName: "Tolu Stores",
      issuedAt: new Date("2026-10-01"),
      dueDate: new Date("2026-11-01"),
      currency: "NGN",
      amount: 150000,
      amountPaid: 0,
      balance: 150000,
      statusLabel: "Awaiting payment",
      bank: { bankName: "Zenith Bank", accountName: "Ada Fabrics Ltd", accountNumber: "1234567890" },
      crypto: null,
    };
    const pages = (pdf) => (pdf.toString("latin1").match(/\/Type \/Page\b(?!s)/g) || []).length;
    const short = await buildInvoicePdf({ ...view, note: "Ankara fabric, 40 yards" });
    const long = await buildInvoicePdf({ ...view, note: "Ankara fabric, 40 yards, delivered to the Yaba shop in two loads. ".repeat(30).slice(0, 2000) });
    expect(pages(short)).toBe(1);
    expect(pages(long)).toBe(2);
  });
});

describe("the debtor payment page", () => {
  it("shows what is owed and how to pay, without the debtor's own contact details", async () => {
    const a = await owner();
    const debt = await anInvoice(a.token);
    await call("PATCH", `/api/debts/${debt._id}`, { token: a.token, body: { debtorPhone: "08031234567", debtorEmail: "bola@example.com" } });
    await call("POST", `/api/debts/${debt._id}/payments`, { token: a.token, body: { amount: 5000, idempotencyKey: "invoice-page-001" } });
    const shared = await call("POST", `/api/debts/${debt._id}/share`, { token: a.token, body: {} });
    const token = shared.body.url.split("/pay/")[1];
    expect(shared.body.url).toBe(`https://www.useledgerwatch.co/pay/${token}`);

    const page = await call("GET", `/api/public/invoices/${token}`);
    expect(page.status).toBe(200);
    expect(page.headers.get("x-robots-tag")).toContain("noindex");
    expect(page.body.invoice).toMatchObject({
      businessName: "Ada Fabrics",
      invoiceNumber: "INV-0001",
      debtorName: "Bola Stores",
      amount: 25000,
      amountPaid: 5000,
      balance: 20000,
      bank: { bankName: "Zenith Bank", accountName: "Ada Fabrics Ltd", accountNumber: "1234567890" },
    });
    expect(JSON.stringify(page.body)).not.toContain("08031234567");
    expect(JSON.stringify(page.body)).not.toContain("bola@example.com");

    const pdf = await call("GET", `/api/public/invoices/${token}/invoice.pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.body.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("stops the old link working when the owner makes a new one", async () => {
    const a = await owner();
    const debt = await anInvoice(a.token);
    const first = (await call("POST", `/api/debts/${debt._id}/share`, { token: a.token, body: {} })).body.url.split("/pay/")[1];
    const again = (await call("POST", `/api/debts/${debt._id}/share`, { token: a.token, body: {} })).body.url.split("/pay/")[1];
    expect(again).toBe(first);
    const renewed = (await call("POST", `/api/debts/${debt._id}/share`, { token: a.token, body: { renew: true } })).body.url.split("/pay/")[1];
    expect(renewed).not.toBe(first);
    expect((await call("GET", `/api/public/invoices/${first}`)).status).toBe(404);
    expect((await call("GET", `/api/public/invoices/${renewed}`)).status).toBe(200);
  });

  it("refuses a link that is not a payment link", async () => {
    expect((await call("GET", "/api/public/invoices/short")).status).toBe(400);
    expect((await call("GET", `/api/public/invoices/${"A".repeat(32)}`)).status).toBe(404);
  });

  it("shows a paid invoice as paid, with nothing left to pay", async () => {
    const a = await owner();
    const debt = await anInvoice(a.token, 1000);
    await call("PATCH", `/api/debts/${debt._id}/paid`, { token: a.token });
    const token = (await call("POST", `/api/debts/${debt._id}/share`, { token: a.token, body: {} })).body.url.split("/pay/")[1];
    const page = await call("GET", `/api/public/invoices/${token}`);
    expect(page.body.invoice).toMatchObject({ balance: 0, status: "paid", bank: null, crypto: null });
  });

  it("puts the invoice number and the payment page in every reminder", async () => {
    const a = await owner();
    const created = await anInvoice(a.token);
    const debt = await Debt.findById(created._id);
    const result = await generateReminderForDebt(debt, a.user);
    expect(result.messageText).toMatch(/See invoice INV-0001 and pay online: https:\/\/www\.useledgerwatch\.co\/pay\/[A-Za-z0-9_-]{32}/);
    expect(await Payment.countDocuments({ debtId: debt._id })).toBe(0);
  });
});

describe("numbering invoices that were created before numbers existed", () => {
  const { backfillInvoiceNumbers } = require("../scripts/backfill-invoice-numbers");

  it("previews, then numbers them in the order they were created, after any number already used", async () => {
    const a = await owner();
    const older = await Debt.create({ userId: a.user._id, debtorName: "First", amount: 1, dueDate: new Date(), createdAt: new Date("2026-01-01") });
    const newer = await Debt.create({ userId: a.user._id, debtorName: "Second", amount: 1, dueDate: new Date(), createdAt: new Date("2026-02-01") });
    await anInvoice(a.token);

    const preview = (await backfillInvoiceNumbers()).find((r) => r.userId === String(a.user._id));
    expect(preview).toMatchObject({ missing: 2, first: "INV-0002", last: "INV-0003", written: 0 });
    expect((await Debt.findById(older._id).lean()).invoiceNumber).toBeUndefined();

    await backfillInvoiceNumbers({ apply: true });
    expect((await Debt.findById(older._id).lean()).invoiceNumber).toBe("INV-0002");
    expect((await Debt.findById(newer._id).lean()).invoiceNumber).toBe("INV-0003");
    expect((await anInvoice(a.token)).invoiceNumber).toBe("INV-0004");
  });
});
