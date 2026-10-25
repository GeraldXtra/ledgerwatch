process.env.JWT_SECRET = process.env.JWT_SECRET || "lw-unsubscribe-tests-only-0123456789abcdefgh";
process.env.SMTP_HOST = "smtp.mail.test";
process.env.SMTP_PORT = "587";
process.env.SMTP_USER = "mailer";
process.env.SMTP_PASS = "pw-9f8e7d6c";
process.env.MAIL_FROM = "LedgerWatch <noreply@useledgerwatch.co>";
process.env.MAIL_REPLY_TO = "";
process.env.CLIENT_URL = "https://www.useledgerwatch.co";
process.env.SERVER_URL = "https://api.useledgerwatch.co";
process.env.ANTHROPIC_API_KEY = "";

const nodemailer = require("nodemailer");
const sent = [];
vi.spyOn(nodemailer, "createTransport").mockReturnValue({
  sendMail: async (message) => {
    sent.push(message);
    return { messageId: `m-${sent.length}` };
  },
});

const app = require("../app");
const User = require("../models/User");
const Debt = require("../models/Debt");
const EmailOptOut = require("../models/EmailOptOut");
const { generateReminderForDebt, dispatchReminder } = require("../services/reminder.service");
const { unsubscribeToken } = require("../services/unsubscribe.service");
const { notifyActivity } = require("../services/activity.service");
const { issueResetCode } = require("../services/passwordReset.service");

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

beforeEach(() => {
  sent.length = 0;
});

async function ownerAndInvoice() {
  const user = await User.create({
    name: "Chidi",
    companyName: "Chidi Electrics",
    email: `owner-${Date.now()}-${++seq}@business.ng`,
    passwordHash: "x",
    emailVerified: true,
  });
  const debt = await Debt.create({
    userId: user._id,
    debtorName: "Ngozi Ventures",
    debtorEmail: `ngozi-${seq}@client.ng`,
    amount: 50000,
    amountKobo: 5000000,
    dueDate: new Date(Date.now() + 86400000),
  });
  return { user, debt };
}

async function remind(user, debt) {
  const result = await generateReminderForDebt(debt, user);
  return dispatchReminder(result.reminder, debt, user, { channels: ["email"], force: true });
}

function post(path, body, type = "application/json") {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": type },
    body: type === "application/json" ? JSON.stringify(body) : body,
  });
}

describe("unsubscribing from payment reminder emails", () => {
  it("offers a one-click unsubscribe on reminders, and replies reach the business", async () => {
    const { user, debt } = await ownerAndInvoice();
    const [delivery] = await remind(user, debt);
    expect(delivery.status).toBe("sent");
    const mail = sent[0];
    expect(mail.replyTo).toBe(user.email);
    expect(mail.subject).toBe("Payment reminder from Chidi Electrics for invoice INV-0001");
    expect(mail.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(mail.headers["List-Unsubscribe"]).toMatch(/^<https:\/\/api\.useledgerwatch\.co\/api\/public\/unsubscribe\/[^>]+>, <mailto:/);
    expect(mail.html).toContain("Stop payment reminder emails from Chidi Electrics");
    expect(mail.html).toContain("View invoice and pay");
  });

  it("honours a mail client's one-click POST and then sends no more reminder emails", async () => {
    const { user, debt } = await ownerAndInvoice();
    await remind(user, debt);
    const oneClick = sent[0].headers["List-Unsubscribe"].match(/^<([^>]+)>/)[1];
    const path = new URL(oneClick).pathname;
    const res = await post(path, "List-Unsubscribe=One-Click", "application/x-www-form-urlencoded");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ kind: "debtor", unsubscribed: true, businessName: "Chidi Electrics" });
    expect(await EmailOptOut.countDocuments({ userId: user._id, email: debt.debtorEmail })).toBe(1);

    sent.length = 0;
    const [delivery] = await remind(user, debt);
    expect(delivery).toMatchObject({ status: "skipped", reason: "unsubscribed" });
    expect(sent).toHaveLength(0);
  });

  it("shows the person what they are unsubscribing from, and lets them change their mind", async () => {
    const { user, debt } = await ownerAndInvoice();
    const token = unsubscribeToken({ kind: "debtor", userId: user._id, email: debt.debtorEmail });
    const info = await (await fetch(`${base}/api/public/unsubscribe/${token}`)).json();
    expect(info).toMatchObject({ kind: "debtor", businessName: "Chidi Electrics", unsubscribed: false });
    expect(info.email).toMatch(/^n\*+@client\.ng$/);
    expect(await (await post(`/api/public/unsubscribe/${token}`, { action: "unsubscribe" })).json()).toMatchObject({ unsubscribed: true });
    expect(await (await post(`/api/public/unsubscribe/${token}`, { action: "resubscribe" })).json()).toMatchObject({ unsubscribed: false });
    expect(await EmailOptOut.countDocuments({ userId: user._id })).toBe(0);
  });

  it("only affects the business that sent the email", async () => {
    const first = await ownerAndInvoice();
    const second = await ownerAndInvoice();
    second.debt.debtorEmail = first.debt.debtorEmail;
    await second.debt.save();
    const token = unsubscribeToken({ kind: "debtor", userId: first.user._id, email: first.debt.debtorEmail });
    await post(`/api/public/unsubscribe/${token}`, { action: "unsubscribe" });
    const [delivery] = await remind(second.user, second.debt);
    expect(delivery.status).toBe("sent");
  });

  it("refuses a link that was tampered with", async () => {
    const { user } = await ownerAndInvoice();
    const token = unsubscribeToken({ kind: "debtor", userId: user._id, email: "someone@client.ng" });
    const forged = token.replace(/.$/, (c) => (c === "A" ? "B" : "A"));
    expect((await fetch(`${base}/api/public/unsubscribe/${forged}`)).status).toBe(404);
    expect((await post(`/api/public/unsubscribe/${forged}`, { action: "unsubscribe" })).status).toBe(404);
  });
});

describe("the owner's own activity emails", () => {
  it("can be switched off from the email itself", async () => {
    const { user } = await ownerAndInvoice();
    await notifyActivity(user._id, { category: "moneyIn", title: "Money arrived", body: "x", email: { subject: "Money arrived", intro: "x" } });
    const mail = sent.find((m) => m.to === user.email);
    expect(mail.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    const path = new URL(mail.headers["List-Unsubscribe"].match(/^<([^>]+)>/)[1]).pathname;
    expect((await (await post(path, "List-Unsubscribe=One-Click", "application/x-www-form-urlencoded")).json()).unsubscribed).toBe(true);
    expect((await User.findById(user._id).lean()).notifyPrefs.emailActivity).toBe(false);
  });
});

describe("account security emails", () => {
  it("carry no unsubscribe link and are not marked as bulk mail", async () => {
    const { user } = await ownerAndInvoice();
    await issueResetCode(user);
    const mail = sent.find((m) => m.to === user.email);
    expect(mail.headers["List-Unsubscribe"]).toBeUndefined();
    expect(mail.headers.Precedence).toBeUndefined();
  });
});
