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
  // Treat a leftover example value as unconfigured. Building a transport around
  // `you@gmail.com` produces an auth rejection that looks like a bug in this app
  // rather than a blank field in .env.
  const usable =
    SMTP_HOST && SMTP_PORT && SMTP_USER && SMTP_PASS && emailConfigStatus().configured;
  if (usable) {
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
    const status = emailConfigStatus();
    console.warn("[email] ================================================================");
    console.warn(`[email] EMAIL IS OFF. ${status.reason}`);
    if (status.missing.length) console.warn(`[email]   missing:      ${status.missing.join(", ")}`);
    if (status.placeholders.length) console.warn(`[email]   placeholder:  ${status.placeholders.join(", ")}`);
    console.warn("[email]");
    console.warn("[email]   Gmail needs an APP PASSWORD, not your account password:");
    console.warn("[email]   turn on 2 step verification, then create one at");
    console.warn("[email]   https://myaccount.google.com/apppasswords and put the 16 characters");
    console.warn("[email]   in SMTP_PASS with no spaces. SMTP_USER and MAIL_FROM must be your");
    console.warn("[email]   real address, not the example one.");
    console.warn("[email]");
    console.warn("[email]   Until this is set, every reminder email is SKIPPED. The reminder");
    console.warn("[email]   itself is still created and the WhatsApp link still works.");
    console.warn("[email] ================================================================");
    return { ok: false, configured: false, reason: status.reason };
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

/**
 * Values shipped in .env.example. A placeholder is WORSE than an empty value:
 * empty makes `getMailer()` return null and every send reports "not-configured",
 * which is at least honest. A placeholder passes the truthiness check, so the
 * transport is built, Gmail rejects the credentials, and the failure arrives as
 * an authentication error that reads like a code fault. This app has already been
 * bitten by exactly that shape with ANTHROPIC_API_KEY.
 */
const PLACEHOLDER_TOKENS = [
  "you@gmail.com",
  "your-app-password",
  "your-16-char-app-password",
  "your-anthropic-api-key",
  "change-me",
];

/**
 * Substring rather than exact match. MAIL_FROM is a display name wrapped around
 * an address (`LedgerWatch <you@gmail.com>`), so an exact comparison misses the
 * example value that is actually sitting there. Matching the token catches every
 * form the same placeholder takes.
 */
const isPlaceholder = (v) => {
  const s = String(v || "").trim().toLowerCase();
  return s !== "" && PLACEHOLDER_TOKENS.some((t) => s.includes(t));
};

/**
 * Why email is or is not usable, in enough detail to act on.
 *
 * `emailConfigured()` used to answer this as a bare boolean AND omitted
 * SMTP_PORT, which `getMailer()` requires — so it could report "configured"
 * while every send was skipped. Naming the missing variable is the difference
 * between a user fixing it in a minute and assuming the feature is broken.
 */
function emailConfigStatus() {
  const required = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "MAIL_FROM"];
  const missing = required.filter((k) => !process.env[k]);
  const placeholders = required.filter((k) => isPlaceholder(process.env[k]));

  if (missing.length) {
    return {
      configured: false,
      missing,
      placeholders,
      reason: `Email is not set up. Missing in server/.env: ${missing.join(", ")}.`,
    };
  }
  if (placeholders.length) {
    return {
      configured: false,
      missing,
      placeholders,
      reason:
        `Email is not set up. These still hold the example values from .env.example: ` +
        `${placeholders.join(", ")}. Replace them with real credentials.`,
    };
  }
  return { configured: true, missing: [], placeholders: [], reason: null };
}

const whatsappConfigured = () =>
  Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_WHATSAPP_FROM);
const emailConfigured = () => emailConfigStatus().configured;

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
/**
 * WHATSAPP DELIVERY — three providers behind one call.
 *
 * Twilio was the original and it is the wrong default for this product. It bills
 * per message on top of Meta's own fee, it needs a paid account before a single
 * real message leaves the sandbox, and the sandbox requires every recipient to
 * text a join code first, which no debtor will ever do. For a small business
 * chasing its own invoices that is a cost and a friction it does not need.
 *
 *   link   (default) Free, works today, no account anywhere. The message is
 *          prepared and handed back as a wa.me link for the owner to send from
 *          their own WhatsApp. One tap per debtor. It keeps the human in the
 *          loop, which is this product's stated design rule anyway, and it costs
 *          nothing. Its honest limit: it cannot fire unattended at 2am.
 *
 *   cloud  WhatsApp Cloud API, direct from Meta, no reseller in between. Meta's
 *          free tier covers a small business comfortably and there is no
 *          per-message platform fee on top. This is the option to grow into and
 *          the only one that can send while nobody is watching.
 *
 *   twilio Kept so an existing configuration keeps working. Not recommended.
 *
 * Every provider returns the same shape, so callers never branch on which one is
 * active. `queued: true` means "prepared for a human to send", which is a real
 * outcome and NOT a failure: recording it as one would put a red error in front
 * of the user for the path that is working exactly as designed.
 */
function whatsappProvider() {
  const explicit = String(process.env.WHATSAPP_PROVIDER || "").trim().toLowerCase();
  if (explicit) return explicit;
  // Infer, so an existing Twilio setup keeps working with no new variable.
  if (process.env.WHATSAPP_CLOUD_TOKEN && process.env.WHATSAPP_CLOUD_PHONE_ID) return "cloud";
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) return "twilio";
  return "link";
}

/** wa.me deep link with the message pre-filled. Free, and always available. */
function buildWaLink(toPhone, body) {
  const { normalizePhone } = require("../utils/phone");
  const { valid, intl } = normalizePhone(toPhone);
  if (!valid) return null;
  return `https://wa.me/${intl}?text=${encodeURIComponent(body)}`;
}

async function sendViaCloud(toPhone, body) {
  const token = process.env.WHATSAPP_CLOUD_TOKEN;
  const phoneId = process.env.WHATSAPP_CLOUD_PHONE_ID;
  if (!token || !phoneId) {
    return { ok: false, skipped: true, reason: "not-configured", error: "WhatsApp Cloud API is not configured." };
  }
  const { normalizePhone } = require("../utils/phone");
  const { valid, intl } = normalizePhone(toPhone);
  if (!valid) return { ok: false, reason: "invalid-number", error: "That phone number is not valid for WhatsApp." };

  try {
    const axios = require("axios");
    const version = process.env.WHATSAPP_CLOUD_VERSION || "v21.0";
    const { data } = await axios.post(
      `https://graph.facebook.com/${version}/${phoneId}/messages`,
      { messaging_product: "whatsapp", to: intl, type: "text", text: { preview_url: false, body } },
      { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 }
    );
    return { ok: true, providerId: data?.messages?.[0]?.id || null, provider: "cloud" };
  } catch (err) {
    /**
     * Meta's own error text is far more useful than the axios wrapper's, and the
     * commonest failure by a mile is code 131047: outside the 24 hour window a
     * business may only open a conversation with an approved template, never
     * free text. Saying that plainly is the difference between a fixable problem
     * and an unexplained failure.
     */
    const meta = err?.response?.data?.error;
    const code = meta?.code;
    let message = meta?.message || err.message;
    if (code === 131047 || code === 131026) {
      message =
        "WhatsApp will not deliver free text to this number because they have not messaged you in the last 24 hours. " +
        "Business initiated reminders need an approved message template.";
    } else if (code === 190) {
      message = "The WhatsApp Cloud token has expired or been revoked. Generate a new one in Meta Business settings.";
    }
    console.error(`[whatsapp] cloud send failed (code=${code || "?"}): ${message}`);
    return { ok: false, reason: "send-failed", error: message, provider: "cloud" };
  }
}

async function sendViaTwilio(toPhone, body) {
  const client = getTwilio();
  const from = process.env.TWILIO_WHATSAPP_FROM;
  if (!client || !from) {
    return { ok: false, skipped: true, reason: "not-configured", error: "Twilio WhatsApp is not configured." };
  }
  const to = toWhatsAppAddress(toPhone);
  if (!to) return { ok: false, reason: "invalid-number", error: "That phone number is not valid for WhatsApp." };
  try {
    const msg = await client.messages.create({ from, to, body });
    return { ok: true, providerId: msg.sid, provider: "twilio" };
  } catch (err) {
    console.error("[whatsapp] twilio send failed:", err.message);
    return { ok: false, reason: "send-failed", error: err.message, provider: "twilio" };
  }
}

async function sendWhatsApp(toPhone, body) {
  const provider = whatsappProvider();
  if (provider === "cloud") return sendViaCloud(toPhone, body);
  if (provider === "twilio") return sendViaTwilio(toPhone, body);

  // link — the free default.
  const link = buildWaLink(toPhone, body);
  if (!link) return { ok: false, reason: "invalid-number", error: "That phone number is not valid for WhatsApp." };
  return {
    ok: false,
    queued: true,
    skipped: true,
    reason: "awaiting-send",
    provider: "link",
    waLink: link,
    error: "Ready to send. Open WhatsApp to deliver it.",
  };
}

function whatsappConfigStatus() {
  const provider = whatsappProvider();
  if (provider === "cloud") {
    const missing = ["WHATSAPP_CLOUD_TOKEN", "WHATSAPP_CLOUD_PHONE_ID"].filter((k) => !process.env[k]);
    return {
      provider,
      automatic: missing.length === 0,
      missing,
      reason: missing.length ? `WhatsApp Cloud API is missing: ${missing.join(", ")}.` : null,
    };
  }
  if (provider === "twilio") {
    const missing = ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_WHATSAPP_FROM"].filter(
      (k) => !process.env[k]
    );
    return {
      provider,
      automatic: missing.length === 0,
      missing,
      reason: missing.length ? `Twilio WhatsApp is missing: ${missing.join(", ")}.` : null,
    };
  }
  return {
    provider: "link",
    automatic: false,
    missing: [],
    reason:
      "WhatsApp reminders are prepared for you to send with one tap. This is free and needs no account. " +
      "For unattended sending, set up the WhatsApp Cloud API and set WHATSAPP_PROVIDER=cloud.",
  };
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
/**
 * Where an unsubscribe click lands. Uses the deployed client URL so the link is
 * real rather than decorative — an unsubscribe header pointing nowhere is worse
 * than none, because it invites a complaint when the link fails.
 */
function unsubscribeUrl(to) {
  const base = (process.env.CLIENT_URL || "http://localhost:5173").split(",")[0].trim();
  return `${base}/unsubscribe?email=${encodeURIComponent(to || "")}`;
}

/** The mailbox an unsubscribe request can be emailed to. */
function unsubscribeMailbox() {
  const raw = process.env.MAIL_UNSUBSCRIBE || process.env.MAIL_FROM || "";
  // MAIL_FROM may be `"Name" <addr>`; the header needs the bare address.
  const match = String(raw).match(/<([^>]+)>/);
  return (match ? match[1] : raw).trim() || "unsubscribe@localhost";
}

async function sendEmail(to, subject, html, opts = {}) {
  const transport = getMailer();
  const from = normalizeFrom(process.env.MAIL_FROM);
  if (!transport || !from) {
    // Name the missing or placeholder variable rather than saying "no SMTP
    // settings". The generic wording sent people looking for a bug in the app;
    // "Missing in server/.env: SMTP_PASS" is something a user can act on without
    // reading any code.
    return {
      ok: false,
      skipped: true,
      reason: "not-configured",
      error: emailConfigStatus().reason || "Email is not configured on the server.",
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
      // Replies should reach the sender, and a From/Reply-To that disagree with
      // each other is itself a mild spam signal. Defaults to From when unset.
      replyTo: normalizeFrom(process.env.MAIL_REPLY_TO) || from,
      subject,
      html,
      // A text/plain alternative alongside the HTML. Bulk senders that omit it
      // score worse with spam filters, and some clients show it in previews.
      text: opts.text || undefined,
      attachments: attachments.length ? attachments : undefined,

      /**
       * DELIVERABILITY HEADERS.
       *
       * Be honest about what these can and cannot do: without a custom domain
       * there is no SPF or DKIM ALIGNMENT, and alignment is the single largest
       * factor in inbox placement. Everything here is the rest of the checklist
       * — worth doing, and not a substitute. See the README section on DNS.
       *
       * Deliberately absent: tracking pixels and redirect links. Both are strong
       * spam signals and neither is worth the analytics.
       */
      headers: {
        // A well-formed unsubscribe path is one of the clearest "legitimate bulk
        // sender" signals there is. BOTH forms, because Gmail honours the HTTPS
        // one-click and older clients only understand mailto.
        "List-Unsubscribe": `<${unsubscribeUrl(to)}>, <mailto:${unsubscribeMailbox()}?subject=unsubscribe>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        // Says plainly that a machine sent this, so filters do not read it as a
        // human failing to get a reply. Also stops well-behaved auto-responders
        // from bouncing back at us.
        "Auto-Submitted": "auto-generated",
        "X-Auto-Response-Suppress": "OOF, AutoReply",
        // Transactional, not marketing: "bulk" is the honest value for an
        // automated reminder a customer expects.
        Precedence: "bulk",
        "X-Entity-Ref-ID": `ledgerwatch-${Date.now()}`,
      },
      // Message-ID, Date and MIME-Version are generated by nodemailer to spec.
      // Setting them by hand risks a malformed value, which is worse than the
      // correct one we already get.
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
  // Only a SUCCESSFUL read is cached. The previous version cached the failure
  // too and did so silently, so a single bad read — a different working
  // directory at boot, a file briefly locked by a sync client, this repo living
  // in OneDrive — meant every email for the entire life of the process went out
  // with no logo, and nothing anywhere said why. A retry costs one small file
  // read.
  if (logoAttachment) return logoAttachment;

  const candidates = [
    // Normal layout: server/src/services -> repo root -> client/public
    require("path").resolve(__dirname, "../../../client/public/icon-192.png"),
    // Deployed layouts where the client is built alongside the server.
    require("path").resolve(process.cwd(), "../client/public/icon-192.png"),
    require("path").resolve(process.cwd(), "client/public/icon-192.png"),
    require("path").resolve(process.cwd(), "public/icon-192.png"),
  ];

  const fs = require("fs");
  for (const file of candidates) {
    try {
      const content = fs.readFileSync(file);
      if (content && content.length > 0) {
        logoAttachment = {
          filename: "ledgerwatch.png",
          content,
          cid: "ledgerwatch-logo",
          contentDisposition: "inline",
        };
        return logoAttachment;
      }
    } catch {
      // Try the next candidate path.
    }
  }

  // Says so, every time, rather than failing silently forever.
  console.warn(
    `[email] logo not found — emails will send without it. Looked in: ${candidates.join(" | ")}`
  );
  return null;
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
  emailConfigStatus,
  whatsappConfigStatus,
  buildWaLink,
};
