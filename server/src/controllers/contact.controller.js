const jwt = require("jsonwebtoken");
const ContactMessage = require("../models/ContactMessage");
const { sendEmail, normalizeFrom } = require("../services/notify.service");
const { verifyTurnstile } = require("../services/turnstile.service");

const TOPIC_LABEL = {
  payment: "A payment or an invoice",
  wallet: "The wallet",
  market: "Market Watch or a trade",
  account: "My account or signing in",
  security: "A security concern",
  other: "Something else",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX = { name: 80, email: 160, message: 4000, page: 200, userAgent: 300 };
const MIN_MESSAGE = 10;

function text(value, max) {
  if (typeof value !== "string") return "";
  return value.replace(/\r\n?/g, "\n").trim().slice(0, max);
}

function esc(s) {
  return String(s == null ? "" : s).replace(
    /[<>&"]/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c])
  );
}

function containsSecret(message) {
  if (/0x[0-9a-fA-F]{64}/.test(message)) return "a private key";
  for (const line of message.split("\n")) {
    const words = line.trim().split(/\s+/).filter(Boolean);
    if (
      (words.length === 12 || words.length === 24) &&
      words.every((w) => /^[a-z]{3,8}$/.test(w))
    ) {
      return "a recovery phrase";
    }
  }
  return null;
}

async function optionalUserId(req) {
  const header = String((req.headers && req.headers.authorization) || "");
  if (!header.startsWith("Bearer ")) return null;
  try {
    const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET, { algorithms: ["HS256"] });
    if (!payload || !payload.id) return null;

    const User = require("../models/User");
    const user = await User.findById(payload.id).select("tokenVersion").lean();
    if (!user) return null;
    if ((Number(payload.v) || 0) !== (Number(user.tokenVersion) || 0)) return null;
    return payload.id;
  } catch {
    return null;
  }
}

function ownerAddress() {
  const explicit = String(process.env.CONTACT_EMAIL || "").trim();
  if (explicit) return explicit;
  const from = String(normalizeFrom(process.env.MAIL_FROM) || "");
  const angle = from.match(/<([^>]+)>/);
  const bare = (angle ? angle[1] : from).trim();
  return bare || String(process.env.SMTP_USER || "").trim();
}

function buildNotice(doc) {
  const topic = TOPIC_LABEL[doc.topic] || TOPIC_LABEL.other;
  const subject = `[LedgerWatch] ${topic}, from ${doc.name}`;
  const lines = [
    `New message from the Contact page.`,
    ``,
    `From: ${doc.name} <${doc.email}>`,
    `Topic: ${topic}`,
    doc.userId ? `Account: ${doc.userId}` : `Account: not signed in`,
    doc.page ? `Page: ${doc.page}` : null,
    `Received: ${doc.createdAt.toISOString()}`,
    ``,
    doc.message,
    ``,
    `Reply to ${doc.email}. Message id ${doc._id}.`,
  ].filter((l) => l !== null);
  const plain = lines.join("\n");

  const FONT = "'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  const row = (k, v) =>
    `<tr><td style="padding:6px 0;color:#64748b;font:400 13px ${FONT};width:110px">${esc(k)}</td>` +
    `<td style="padding:6px 0;color:#0a1428;font:400 13px ${FONT}">${esc(v)}</td></tr>`;
  const html = `
  <div style="max-width:640px;margin:0 auto;padding:24px;font:400 14px/1.6 ${FONT};color:#0a1428">
    <h2 style="margin:0 0 14px;font:600 18px ${FONT}">New message from the Contact page</h2>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:16px">
      ${row("From", `${doc.name} <${doc.email}>`)}
      ${row("Topic", topic)}
      ${row("Account", doc.userId ? String(doc.userId) : "not signed in")}
      ${doc.page ? row("Page", doc.page) : ""}
      ${row("Received", doc.createdAt.toISOString())}
    </table>
    <div style="white-space:pre-wrap;padding:14px 16px;background:#f4f7fa;border:1px solid #e1e7f0;border-radius:8px">${esc(
      doc.message
    )}</div>
    <p style="margin:16px 0 0;color:#64748b;font-size:12px">Reply to ${esc(doc.email)}. Message id ${esc(
      String(doc._id)
    )}.</p>
  </div>`;

  return { subject, plain, html };
}

async function submit(req, res) {
  try {
    return await submitInner(req, res);
  } catch (err) {
    console.error("contact submit error:", err && err.message);
    return res.status(500).json({
      error:
        "Your message could not be saved just now. Please try again in a moment, " +
        "or email us directly if it keeps happening.",
    });
  }
}

async function submitInner(req, res) {
  const body = req.body || {};

  if (typeof body.extra === "string" && body.extra.trim()) {
    return res.json({ ok: true });
  }

  const name = text(body.name, MAX.name);
  const email = text(body.email, MAX.email).toLowerCase();
  const message = text(body.message, MAX.message);
  const topic = Object.prototype.hasOwnProperty.call(TOPIC_LABEL, body.topic) ? body.topic : "other";
  const page = text(body.page, MAX.page);
  const userAgent = text(req.headers && req.headers["user-agent"], MAX.userAgent);

  if (!name) return res.status(400).json({ error: "Tell me your name so I know who I am writing back to." });
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: "Enter a valid email address. It is the only way I can reply." });
  }
  if (message.length < MIN_MESSAGE) {
    return res.status(400).json({ error: "Say a little more about what happened, so I can actually help." });
  }

  const secret = containsSecret(message);
  if (secret) {
    return res.status(400).json({
      error:
        `That message looks like it contains ${secret}. Please remove it. Nobody at LedgerWatch ` +
        `will ever need it, and anyone who asks for it is not from LedgerWatch.`,
    });
  }

  const human = await verifyTurnstile(body.turnstileToken, req.ip);
  if (!human.ok) return res.status(400).json({ error: human.error, turnstile: true });

  const doc = await ContactMessage.create({
    userId: await optionalUserId(req),
    name,
    email,
    topic,
    message,
    page,
    userAgent,
  });

  const to = ownerAddress();
  if (to) {
    const notice = buildNotice(doc);
    const sent = await sendEmail(to, notice.subject, notice.html, { text: notice.plain });
    doc.emailed = Boolean(sent && sent.ok);
    doc.emailError = doc.emailed ? "" : String((sent && (sent.error || sent.reason)) || "not sent");
  } else {
    doc.emailError = "no owner address configured";
  }
  await doc.save();

  return res.status(201).json({ ok: true });
}

module.exports = { submit, containsSecret, TOPIC_LABEL };
