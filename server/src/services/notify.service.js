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
        /**
         * TIMEOUTS MATTER MORE THAN THEY LOOK. Without them nodemailer waits on
         * its own very generous defaults, so a network blip reaching Gmail holds
         * the HTTP request open until the browser gives up — and the user sees a
         * bare "Send failed" with no server response to explain it. There is a
         * real `connect ETIMEDOUT ...:587` in this app's own delivery history.
         * Failing in seconds with a nameable error is far more useful.
         */
        connectionTimeout: Number(process.env.SMTP_CONNECTION_TIMEOUT_MS || 10000),
        greetingTimeout: Number(process.env.SMTP_GREETING_TIMEOUT_MS || 10000),
        socketTimeout: Number(process.env.SMTP_SOCKET_TIMEOUT_MS || 20000),
      });
    } catch (err) {
      console.error("Mailer init failed:", err.message);
      mailer = null;
    }
  }
  return mailer;
}

/**
 * Confirm the SMTP credentials and connection at boot.
 *
 * Left until the first send, a wrong password or an unreachable host is only
 * discovered when a user is waiting on a reminder. Never throws.
 */
async function verifyEmail() {
  const transport = getMailer();
  if (!transport) {
    console.log("[email] SMTP not configured — email sends will be skipped.");
    return { ok: false, configured: false };
  }
  try {
    await transport.verify();
    console.log(`[email] SMTP ready as ${normalizeFrom(process.env.MAIL_FROM)}`);
    return { ok: true, configured: true };
  } catch (err) {
    console.error(
      `[email] SMTP verification FAILED: ${describeMailError(err)} ` +
        `(code=${err.code || "?"} responseCode=${err.responseCode || "?"})`
    );
    return { ok: false, configured: true, error: describeMailError(err) };
  }
}

/**
 * A nodemailer error turned into a typed reason plus wording a non-technical
 * user can act on. `err.message` alone loses `code`, `responseCode` and
 * `response`, which are the fields that actually name the cause.
 */
function classifyMailError(err) {
  const code = err && err.code;
  const responseCode = err && err.responseCode;
  const text = `${(err && err.message) || ""} ${(err && err.response) || ""}`;

  if (code === "EAUTH" || responseCode === 535 || /invalid login|username and password/i.test(text)) {
    return {
      reason: "auth-rejected",
      message:
        "The mail server rejected the login. For Gmail this must be a 16 character App Password, not your normal password.",
    };
  }
  if (code === "ETIMEDOUT" || code === "ECONNECTION" || code === "ESOCKET" || code === "ECONNRESET") {
    return {
      reason: "connection-failed",
      message: "Could not reach the mail server. Check the connection and try again.",
    };
  }
  if (code === "EDNS" || code === "ENOTFOUND") {
    return { reason: "host-not-found", message: "The mail server hostname could not be resolved." };
  }
  if (code === "EENVELOPE" || responseCode === 550 || responseCode === 553 || responseCode === 554) {
    return {
      reason: "recipient-refused",
      message: "The mail server refused that recipient address.",
    };
  }
  if (code === "EMESSAGE") {
    return { reason: "message-rejected", message: "The mail server rejected the message content." };
  }
  return { reason: "send-failed", message: (err && err.message) || "The email could not be sent." };
}

function describeMailError(err) {
  return classifyMailError(err).message;
}

/**
 * Reserved, non-routable domains (RFC 2606 / RFC 6761). Mail to these is often
 * ACCEPTED at the SMTP handshake and bounced afterwards, so the send records as
 * "sent" and nothing ever arrives — which is worse than a visible failure.
 */
const NON_ROUTABLE_DOMAIN = /@([^@]*\.)?(example|test|invalid|localhost)(\.[a-z]{2,})?$/i;

function isNonRoutableEmail(address) {
  return NON_ROUTABLE_DOMAIN.test(String(address || "").trim());
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

/**
 * A From header nodemailer and every client will parse the same way.
 *
 * `MAIL_FROM="LedgerWatch you@gmail.com"` (no angle brackets) is the easy mistake
 * to make in a .env, and it renders the display name wrongly rather than failing
 * loudly. If there is a bare address with a name in front of it, wrap it.
 */
function normalizeFrom(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  if (/<[^>]+@[^>]+>/.test(value)) return value; // already correct
  const match = value.match(/^(.*?)\s*([^\s<>]+@[^\s<>]+)$/);
  if (!match) return value;
  const [, name, address] = match;
  return name ? `"${name.replace(/"/g, "")}" <${address}>` : address;
}

/**
 * @param {string} to
 * @param {string} subject
 * @param {string} html
 * @param {{text?:string, attachments?:Array}} [opts]
 *   `attachments` may carry inline images with a `cid`. That is the ONLY reliable
 *   way to show an image in Gmail: `data:` URI images are stripped outright, so a
 *   QR embedded that way silently never appears.
 */
async function sendEmail(to, subject, html, opts = {}) {
  const transport = getMailer();
  const from = normalizeFrom(process.env.MAIL_FROM);
  if (!transport || !from) {
    return {
      ok: false,
      skipped: true,
      reason: "not-configured",
      error: "Email is not configured on the server (no SMTP settings).",
    };
  }
  if (!to) {
    return { ok: false, reason: "no-address", error: "This client has no email address on file." };
  }

  /**
   * Drop an attachment whose bytes are missing rather than letting it fail the
   * whole message. A reminder that arrives without its logo is a cosmetic loss;
   * a reminder that never arrives because an icon moved is a real one.
   */
  const attachments = (opts.attachments || []).filter((a) => {
    const present = a && a.content && a.content.length > 0;
    if (!present) {
      console.warn(`[email] dropping attachment "${a && a.filename}" — no content available`);
    }
    return present;
  });

  try {
    const info = await transport.sendMail({
      from,
      to,
      subject,
      html,
      // A text/plain alternative alongside the HTML. Bulk senders that omit it
      // score worse with spam filters, and some clients show it in previews.
      text: opts.text || undefined,
      attachments: attachments.length ? attachments : undefined,
    });

    // Accepted at the handshake is not the same as delivered. A reserved domain
    // is accepted and then bounced, so say so rather than reporting clean success.
    if (isNonRoutableEmail(to)) {
      console.warn(`[email] ${to} uses a reserved domain — this will bounce and never arrive.`);
      return {
        ok: true,
        providerId: info.messageId,
        warning:
          "Accepted by the mail server, but this address uses a reserved domain (example.com and similar) so it will bounce and never arrive.",
      };
    }
    return { ok: true, providerId: info.messageId };
  } catch (err) {
    const { reason, message } = classifyMailError(err);
    // The FULL error, not just err.message — code, responseCode, command and the
    // server's own response text are what actually identify the cause.
    console.error("[email] send failed:", {
      reason,
      code: err.code,
      responseCode: err.responseCode,
      command: err.command,
      response: err.response,
      message: err.message,
    });
    return { ok: false, reason, error: message };
  }
}

/**
 * Inline logo attachment, read from the client's PWA icon so the email mark and
 * the app mark can never drift apart. Cached after the first read.
 * Returns null if the file is missing, and the header falls back to text.
 */
let logoAttachment;
function getLogoAttachment() {
  if (logoAttachment !== undefined) return logoAttachment;
  try {
    // eslint-disable-next-line global-require
    const fs = require("fs");
    // eslint-disable-next-line global-require
    const path = require("path");
    const file = path.resolve(__dirname, "../../../client/public/icon-192.png");
    logoAttachment = {
      filename: "ledgerwatch.png",
      content: fs.readFileSync(file),
      cid: "ledgerwatch-logo",
      contentDisposition: "inline",
    };
  } catch {
    logoAttachment = null;
  }
  return logoAttachment;
}

/**
 * The branded reminder email.
 *
 * WRITTEN FOR EMAIL CLIENTS, NOT BROWSERS. Nested tables rather than flexbox or
 * grid, every style inlined, no external stylesheet, no web font, and images only
 * as `cid:` attachments. Outlook renders through Word's engine and Gmail strips
 * <style> blocks and `data:` images, so anything cleverer than this silently
 * degrades for most of the people who will actually read it.
 */
const FONT = "'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const INK = "#0a1428";
const NAVY = "#16294a";
const GOLD = "#c0a053";
const BODY = "#3a4658";
const MUTED = "#64748b";
const LINE = "#e1e7f0";
const WELL = "#f4f7fa";

function esc(s) {
  return String(s == null ? "" : s).replace(
    /[<>&"]/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c])
  );
}

function money(amount) {
  return Number(amount || 0).toLocaleString("en-NG", { maximumFractionDigits: 2 });
}

function buildReminderEmail({
  businessName,
  messageText,
  bankDetails,
  amount,
  dueDate,
  debtorName,
  cryptoHtml,
  hasLogo,
}) {
  const bodyHtml = esc(messageText)
    .split(/\n{2,}/)
    .map(
      (p) =>
        `<p style="margin:0 0 14px;font:400 15px/1.7 ${FONT};color:${BODY}">${p.replace(/\n/g, "<br>")}</p>`
    )
    .join("");

  const supplier = esc(businessName || "your supplier");

  // Preheader: the grey line clients show beside the subject. Kept out of sight in
  // the body itself, otherwise the first words of the letter get repeated.
  const preheader = amount
    ? `${money(amount)} naira outstanding to ${supplier}`
    : `A payment reminder from ${supplier}`;

  const logoCell = hasLogo
    ? `<img src="cid:ledgerwatch-logo" width="36" height="36" alt=""
            style="display:block;border:0;border-radius:9px" />`
    : "";

  const summary =
    amount || dueDate
      ? `<tr><td style="padding:0 28px 4px">
           <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                  style="background:${WELL};border:1px solid ${LINE};border-radius:12px">
             <tr>
               ${
                 amount
                   ? `<td style="padding:16px 18px">
                        <div style="font:600 11px ${FONT};letter-spacing:.08em;text-transform:uppercase;color:${MUTED}">Amount outstanding</div>
                        <div style="font:700 24px ${FONT};color:${INK};padding-top:5px">&#8358;${money(amount)}</div>
                      </td>`
                   : ""
               }
               ${
                 dueDate
                   ? `<td style="padding:16px 18px;text-align:right;vertical-align:middle">
                        <div style="font:600 11px ${FONT};letter-spacing:.08em;text-transform:uppercase;color:${MUTED}">Due</div>
                        <div style="font:600 15px ${FONT};color:${INK};padding-top:5px">${esc(dueDate)}</div>
                      </td>`
                   : ""
               }
             </tr>
           </table>
         </td></tr>`
      : "";

  const bank =
    bankDetails && bankDetails.accountNumber
      ? `<tr><td style="padding:16px 28px 4px">
           <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                  style="border:1px solid ${LINE};border-radius:12px">
             <tr><td style="background:${WELL};padding:12px 18px;border-bottom:1px solid ${LINE};
                            font:600 13px ${FONT};color:${NAVY};border-radius:12px 12px 0 0">
               Pay by bank transfer
             </td></tr>
             <tr><td style="padding:16px 18px;font:400 14px/1.7 ${FONT};color:${BODY}">
               <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                      style="font:400 14px ${FONT}">
                 ${
                   bankDetails.bankName
                     ? `<tr><td style="padding:3px 0;color:${MUTED}">Bank</td>
                        <td style="padding:3px 0;text-align:right;color:${INK};font-weight:600">${esc(bankDetails.bankName)}</td></tr>`
                     : ""
                 }
                 ${
                   bankDetails.accountName
                     ? `<tr><td style="padding:3px 0;color:${MUTED}">Account name</td>
                        <td style="padding:3px 0;text-align:right;color:${INK};font-weight:600">${esc(bankDetails.accountName)}</td></tr>`
                     : ""
                 }
                 <tr><td style="padding:3px 0;color:${MUTED}">Account number</td>
                     <td style="padding:3px 0;text-align:right;color:${INK};font-weight:700;font-size:16px;letter-spacing:.04em">${esc(bankDetails.accountNumber)}</td></tr>
               </table>
             </td></tr>
           </table>
         </td></tr>`
      : "";

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title>Payment reminder</title>
</head>
<body style="margin:0;padding:0;background:#eef2f8;-webkit-text-size-adjust:100%">

<div style="display:none;font-size:1px;color:#eef2f8;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden">${esc(preheader)}</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
       style="background:#eef2f8;padding:28px 12px">
  <tr><td align="center">

    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
           style="width:100%;max-width:600px;background:#ffffff;border:1px solid ${LINE};
                  border-radius:16px;overflow:hidden">

      <!-- brand bar -->
      <tr><td style="height:4px;background:${GOLD};line-height:4px;font-size:0">&nbsp;</td></tr>

      <!-- header: logo + wordmark -->
      <tr><td style="padding:24px 28px 18px;border-bottom:1px solid ${LINE}">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr>
            ${logoCell ? `<td style="padding-right:12px;vertical-align:middle">${logoCell}</td>` : ""}
            <td style="vertical-align:middle">
              <div style="font:700 19px ${FONT};color:${INK};letter-spacing:-.2px">Ledger<span style="color:${GOLD}">Watch</span></div>
              <div style="font:400 12px ${FONT};color:${MUTED};padding-top:2px">Payment reminder from ${supplier}</div>
            </td>
          </tr>
        </table>
      </td></tr>

      <!-- greeting + letter -->
      <tr><td style="padding:24px 28px 4px">
        ${debtorName ? `<div style="font:600 16px ${FONT};color:${INK};padding-bottom:12px">Hello ${esc(debtorName)},</div>` : ""}
        ${bodyHtml}
      </td></tr>

      ${summary}
      ${bank}
      ${cryptoHtml ? `<tr><td style="padding:16px 28px 4px">${cryptoHtml}</td></tr>` : ""}

      <!-- footer -->
      <tr><td style="padding:22px 28px 24px">
        <div style="border-top:1px solid ${LINE};padding-top:16px;font:400 12px/1.6 ${FONT};color:${MUTED}">
          Reply to this email to arrange payment or raise a query with ${supplier}.<br>
          Sent with <span style="color:${BODY};font-weight:600">LedgerWatch</span>.
        </div>
      </td></tr>

    </table>

  </td></tr>
</table>
</body></html>`;
}

module.exports = {
  sendWhatsApp,
  sendEmail,
  buildReminderEmail,
  getLogoAttachment,
  normalizeFrom,
  verifyEmail,
  classifyMailError,
  isNonRoutableEmail,
  whatsappConfigured,
  emailConfigured,
};
