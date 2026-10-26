process.env.JWT_SECRET = process.env.JWT_SECRET || "lw-153-auto-send-tests-0123456789abcdefgh";
process.env.ANTHROPIC_API_KEY = "";
process.env.CLIENT_URL = "https://www.useledgerwatch.co";
process.env.SERVER_URL = "https://api.useledgerwatch.co";
process.env.WHATSAPP_PROVIDER = "link";
process.env.SMTP_HOST = "smtp.mail.test";
process.env.SMTP_PORT = "587";
process.env.SMTP_USER = "mailer";
process.env.SMTP_PASS = "pw-9f8e7d6c";
process.env.MAIL_FROM = "LedgerWatch <noreply@useledgerwatch.co>";

const nodemailer = require("nodemailer");
const webpush = require("web-push");
const sent = [];
vi.spyOn(nodemailer, "createTransport").mockReturnValue({
  sendMail: async (m) => {
    sent.push(m);
    return { messageId: `m-${sent.length}` };
  },
  verify: async () => true,
});

const app = require("../app");
const User = require("../models/User");
const Debt = require("../models/Debt");
const Reminder = require("../models/Reminder");
const PushSubscription = require("../models/PushSubscription");
const signToken = require("../utils/token");
const { runAllPasses, autoSendOutcome } = require("../services/automation");

const pair = webpush.generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = pair.publicKey;
process.env.VAPID_PRIVATE_KEY = pair.privateKey;
process.env.VAPID_SUBJECT = "mailto:ops@business.ng";

let server;
let base;
let seq = 0;
let pushes;

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
  pushes = [];
  vi.spyOn(webpush, "sendNotification").mockImplementation(async (sub, body) => {
    pushes.push(JSON.parse(body));
    return { statusCode: 201 };
  });
});

afterEach(() => {
  webpush.sendNotification.mockRestore();
});

async function ownerWith({ whatsapp, email }) {
  const user = await User.create({
    name: "Ada",
    companyName: "Ada Fabrics",
    email: `lw153-${Date.now()}-${++seq}@example.com`,
    passwordHash: "x",
    emailVerified: true,
    autoSend: { enabled: true, whatsapp, email },
    bankDetails: { bankName: "Zenith", accountName: "Ada Fabrics", accountNumber: "1234567890" },
  });
  await PushSubscription.create({
    userId: user._id,
    endpoint: `https://fcm.googleapis.com/fcm/send/owner-${seq}`,
    keys: { p256dh: "B".repeat(87), auth: "A".repeat(22) },
  });
  return { user, token: signToken(user._id, user.tokenVersion) };
}

async function overdueDebt(user, extra = {}) {
  return Debt.create({
    userId: user._id,
    debtorName: "Bola Stores",
    debtorPhone: "08031234567",
    amount: 45000,
    amountKobo: 4500000,
    dueDate: new Date(Date.now() - 5 * 86400000),
    status: "pending",
    reminderCadenceDays: 3,
    history: [],
    ...extra,
  });
}

async function call(path, token) {
  const res = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  return { status: res.status, body: await res.json() };
}

describe("LW-153 — an automatic reminder that reached nobody is not counted as sent", () => {
  it("a WhatsApp-only reminder on a server with no WhatsApp provider tells the owner, with the reason", async () => {
    const { user } = await ownerWith({ whatsapp: true, email: false });
    const debt = await overdueDebt(user);

    const result = await runAllPasses({ userId: user._id });

    expect(result).toMatchObject({ generated: 1, remindersNotDelivered: 1, remindersFailed: 0 });
    const reminder = await Reminder.findOne({ debtId: debt._id }).lean();
    expect(reminder.deliveries).toHaveLength(1);
    expect(reminder.deliveries[0]).toMatchObject({ channel: "whatsapp", status: "queued" });
    expect(reminder.status).not.toBe("sent");
    expect(pushes).toHaveLength(1);
    expect(pushes[0].title).toBe("Reminder not sent to Bola Stores");
    expect(pushes[0].body).toMatch(/WhatsApp/);
    expect(pushes[0].body).toMatch(/cannot send WhatsApp messages by itself/i);
    expect(pushes[0].actions.map((a) => a.action)).toContain("send_whatsapp");
    expect(sent).toHaveLength(0);
  });

  it("a reminder that was emailed counts as sent and the owner is not nagged", async () => {
    const { user } = await ownerWith({ whatsapp: true, email: true });
    await overdueDebt(user, { debtorEmail: "bola@client.example" });

    const result = await runAllPasses({ userId: user._id });

    expect(result).toMatchObject({ generated: 1, remindersNotDelivered: 0 });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("bola@client.example");
    expect(pushes).toHaveLength(0);
  });

  it("a cadence skip alone still counts as delivered, so a recent send is not reported as a failure", () => {
    expect(autoSendOutcome([{ channel: "email", status: "skipped", error: "Already sent this cadence window" }])).toMatchObject({ delivered: true, notSent: [] });
    expect(autoSendOutcome([{ channel: "whatsapp", status: "queued", reason: "awaiting-send", error: "Ready to send." }]).delivered).toBe(false);
    expect(autoSendOutcome([{ channel: "email", status: "failed", error: "SMTP refused" }]).notSent).toHaveLength(1);
    expect(autoSendOutcome([]).delivered).toBe(false);
  });

  it("the automation status says which channels this server can send by itself", async () => {
    const { token } = await ownerWith({ whatsapp: true, email: true });
    const res = await call("/api/automation/status", token);
    expect(res.status).toBe(200);
    expect(res.body.reminderChannels.email).toMatchObject({ automatic: true, reason: null });
    expect(res.body.reminderChannels.whatsapp).toMatchObject({ provider: "link", automatic: false });
    expect(res.body.reminderChannels.whatsapp.reason).toMatch(/WHATSAPP_PROVIDER=cloud/);
  });
});
