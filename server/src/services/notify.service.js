/**
 * Outbound messaging — WhatsApp (Twilio) and Email (Nodemailer SMTP).
 *
 * BOTH channels degrade gracefully: if the provider env vars are absent, the send
 * is a no-op that returns { ok:false, skipped:true } and NEVER throws. The manual
 * wa.me link remains the always-available fallback. Providers are lazily created
 * once and reused.
 */
let twilioClient = null;
let twilioLoaded = false;
let mailer = null;
let mailerLoaded = false;

function getTwilio() {
  if (twilioLoaded) return twilioClient;
  twilioLoaded = true;
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = process.env;
  if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
    try {
      twilioClient = require("twilio")(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
    } catch (err) {
      console.error("Twilio init failed:", err.message);
      twilioClient = null;
    }
  }
  return twilioClient;
}

function getMailer() {
  if (mailerLoaded) return mailer;
  mailerLoaded = true;
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (SMTP_HOST && SMTP_PORT && SMTP_USER && SMTP_PASS) {
    try {
      mailer = require("nodemailer").createTransport({
        host: SMTP_HOST,
        port: Number(SMTP_PORT),
        secure: Number(SMTP_PORT) === 465,
        auth: { user: SMTP_USER, pass: SMTP_PASS },
      });
    } catch (err) {
      console.error("Mailer init failed:", err.message);
      mailer = null;
    }
  }
  return mailer;
}

const whatsappConfigured = () =>
  Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_WHATSAPP_FROM);
const emailConfigured = () =>
  Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && process.env.MAIL_FROM);

// Normalise a phone to the E.164 form Twilio's WhatsApp channel expects.
function toWhatsAppAddress(phone) {
  const { normalizePhone } = require("../utils/phone");
  const { valid, intl } = normalizePhone(phone);
  if (!valid) return null;
  return `whatsapp:+${intl}`;
}

/**
 * @returns {Promise<{ok:boolean, skipped?:boolean, providerId?:string, error?:string}>}
 */
async function sendWhatsApp(toPhone, body) {
  const client = getTwilio();
  const from = process.env.TWILIO_WHATSAPP_FROM;
  if (!client || !from) return { ok: false, skipped: true, error: "WhatsApp not configured" };

  const to = toWhatsAppAddress(toPhone);
  if (!to) return { ok: false, error: "Invalid phone number" };

  try {
    const msg = await client.messages.create({ from, to, body });
    return { ok: true, providerId: msg.sid };
  } catch (err) {
    console.error("WhatsApp send failed:", err.message);
    return { ok: false, error: err.message };
  }
}

async function sendEmail(to, subject, html) {
  const transport = getMailer();
  if (!transport || !process.env.MAIL_FROM) {
    return { ok: false, skipped: true, error: "Email not configured" };
  }
  if (!to) return { ok: false, error: "No email address on file" };

  try {
    const info = await transport.sendMail({ from: process.env.MAIL_FROM, to, subject, html });
    return { ok: true, providerId: info.messageId };
  } catch (err) {
    console.error("Email send failed:", err.message);
    return { ok: false, error: err.message };
  }
}

// Brand-matched HTML email (navy + gold) wrapping the reminder text + bank details.
function buildReminderEmail({ businessName, messageText, bankDetails, currency, amount }) {
  const safe = (s) => String(s || "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
  const bodyHtml = safe(messageText).replace(/\n/g, "<br>");
  const bank = bankDetails && bankDetails.accountNumber
    ? `<tr><td style="padding:14px 20px;background:#f4f7fa;border-radius:10px;color:#3a4658;font-size:14px;line-height:1.6">
         <strong style="color:#0a1428">Payment details</strong><br>
         ${safe(bankDetails.accountName || "")}${bankDetails.bankName ? " · " + safe(bankDetails.bankName) : ""}<br>
         Account number: <strong>${safe(bankDetails.accountNumber)}</strong>
       </td></tr>`
    : "";

  return `<!doctype html><html><body style="margin:0;background:#f2f5f9;padding:24px;font-family:Inter,Segoe UI,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e1e7f0;border-radius:14px;overflow:hidden">
    <tr><td style="height:4px;background:linear-gradient(90deg,#16294a,#c0a053)"></td></tr>
    <tr><td style="padding:22px 20px 6px">
      <span style="font-weight:700;font-size:16px;color:#0a1428">Ledger<span style="color:#c0a053">Watch</span></span>
      <div style="color:#64748b;font-size:12px;margin-top:2px">Payment reminder from ${safe(businessName || "your supplier")}</div>
    </td></tr>
    <tr><td style="padding:12px 20px;color:#3a4658;font-size:15px;line-height:1.7">${bodyHtml}</td></tr>
    ${bank ? `<tr><td style="padding:6px 20px 18px"><table width="100%">${bank}</table></td></tr>` : ""}
    <tr><td style="padding:14px 20px;border-top:1px solid #e1e7f0;color:#94a3b8;font-size:12px">
      Sent via LedgerWatch. Please reply directly to arrange payment.
    </td></tr>
  </table></body></html>`;
}

module.exports = {
  sendWhatsApp,
  sendEmail,
  buildReminderEmail,
  whatsappConfigured,
  emailConfigured,
};
