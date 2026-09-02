const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { sendEmail, getLogoAttachment } = require("./notify.service");

/**
 * Email verification codes.
 *
 * Six digits, thirty minutes, hashed at rest, rate limited on both the guessing
 * side and the sending side. Every one of those is load bearing and the reasons
 * are written next to the code that enforces them.
 */

const CODE_LENGTH = 6;
const TTL_MS = 30 * 60 * 1000; // thirty minutes, as specified
const MAX_ATTEMPTS = 6;
const RESEND_COOLDOWN_MS = 60 * 1000;
const SALT_ROUNDS = 10;

/**
 * `crypto.randomInt` rather than `Math.random`.
 *
 * Math.random is seeded from a predictable source and is not designed to resist
 * anyone. This code is a credential that logs somebody into an account holding
 * a ledger of who owes them money, so it gets a cryptographic generator like the
 * password hashing a few lines down.
 *
 * Zero padded so every code is exactly six characters. Without the padding one
 * in ten codes is five digits, which looks broken to the person typing it and
 * silently breaks any fixed length input.
 */
function generateCode() {
  return String(crypto.randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, "0");
}

const esc = (s) =>
  String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * The verification email.
 *
 * Built with nested tables and fully inlined styles, because Outlook renders
 * through Word and Gmail strips a <style> block. The logo is attached by content
 * id rather than embedded as a data URI, because Gmail strips those too and the
 * mark would simply be missing.
 *
 * House style: no hyphens or dashes anywhere in the copy.
 */
function buildVerificationEmail({ name, code, minutes, hasLogo }) {
  const first = String(name || "").trim().split(/\s+/)[0] || "there";
  const logo = hasLogo
    ? `<img src="cid:ledgerwatch-logo" width="44" height="44" alt="LedgerWatch"
         style="display:block;border:0;outline:none;text-decoration:none;border-radius:10px;" />`
    : "";

  const digits = code
    .split("")
    .map(
      (d) =>
        `<td style="padding:0 5px;">
           <div style="width:44px;height:56px;line-height:56px;text-align:center;
                       background:#ffffff;border:1px solid #dce4f0;border-radius:8px;
                       font-family:'Courier New',Courier,monospace;font-size:26px;
                       font-weight:700;color:#0a1428;letter-spacing:1px;">${esc(d)}</div>
         </td>`
    )
    .join("");

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Confirm your LedgerWatch email</title></head>
<body style="margin:0;padding:0;background:#f2f5f9;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">
  Your LedgerWatch confirmation code is ${esc(code)}. It expires in ${minutes} minutes.
</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f2f5f9;">
 <tr><td align="center" style="padding:32px 16px;">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
         style="width:600px;max-width:100%;background:#ffffff;border:1px solid #e1e7f0;border-radius:14px;overflow:hidden;">

   <tr><td style="background:#16294a;padding:24px 32px;">
     <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
       <td style="padding-right:12px;">${logo}</td>
       <td style="font-family:Helvetica,Arial,sans-serif;font-size:19px;font-weight:700;
                  color:#ffffff;letter-spacing:0.2px;">LedgerWatch</td>
     </tr></table>
   </td></tr>

   <tr><td style="padding:34px 32px 8px 32px;font-family:Helvetica,Arial,sans-serif;">
     <div style="font-size:12px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:#64748b;">
       Confirm your email
     </div>
     <div style="font-size:25px;font-weight:700;color:#0a1428;margin-top:10px;line-height:1.25;">
       Hello ${esc(first)}, one step left
     </div>
     <div style="font-size:15px;line-height:1.65;color:#3a4658;margin-top:14px;">
       Thank you for creating a LedgerWatch account. Enter the code below to confirm that this
       mailbox belongs to you and your account will be ready to use.
     </div>
   </td></tr>

   <tr><td align="center" style="padding:26px 32px 10px 32px;">
     <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${digits}</tr></table>
   </td></tr>

   <tr><td align="center" style="padding:0 32px 24px 32px;font-family:Helvetica,Arial,sans-serif;">
     <div style="font-size:13px;color:#64748b;">
       This code expires in <strong style="color:#0a1428;">${minutes} minutes</strong>.
     </div>
   </td></tr>

   <tr><td style="padding:0 32px 28px 32px;">
     <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
            style="background:#f4f7fa;border:1px solid #e1e7f0;border-radius:10px;">
      <tr><td style="padding:18px 20px;font-family:Helvetica,Arial,sans-serif;
                     font-size:13px;line-height:1.7;color:#3a4658;">
        <strong style="color:#0a1428;">What LedgerWatch does for you</strong><br />
        It keeps track of who owes you and when the money was due, drafts the reminder, and stops
        chasing the moment an invoice is settled. Over time it builds a picture of who actually
        pays on schedule.
      </td></tr>
     </table>
   </td></tr>

   <tr><td style="padding:0 32px 30px 32px;font-family:Helvetica,Arial,sans-serif;
                  font-size:12.5px;line-height:1.7;color:#64748b;border-top:1px solid #e1e7f0;padding-top:20px;">
     If you did not create this account you can ignore this message and nothing will happen.
     Nobody can use this code without access to your mailbox.<br /><br />
     <span style="color:#94a3b8;">LedgerWatch. Sent because somebody used this address to create an account.</span>
   </td></tr>

  </table>
 </td></tr>
</table>
</body></html>`;

  const text = [
    `Hello ${first}, one step left.`,
    "",
    `Your LedgerWatch confirmation code is: ${code}`,
    "",
    `This code expires in ${minutes} minutes.`,
    "",
    "LedgerWatch keeps track of who owes you and when the money was due, drafts the reminder,",
    "and stops chasing the moment an invoice is settled.",
    "",
    "If you did not create this account you can ignore this message.",
  ].join("\n");

  return { html, text };
}

/**
 * Mint a code, store its hash, and email it.
 *
 * The plain code exists only inside this function and inside the email. It is
 * never returned to a caller and never logged, so a controller cannot leak it
 * into a response body by accident.
 */
async function issueCode(user, { force = false } = {}) {
  const now = Date.now();
  const last = user.emailVerification?.lastSentAt;
  if (!force && last && now - new Date(last).getTime() < RESEND_COOLDOWN_MS) {
    const wait = Math.ceil((RESEND_COOLDOWN_MS - (now - new Date(last).getTime())) / 1000);
    return { ok: false, reason: "cooldown", retryAfter: wait, error: `Please wait ${wait} seconds before asking for another code.` };
  }

  const code = generateCode();
  user.emailVerification = {
    codeHash: await bcrypt.hash(code, SALT_ROUNDS),
    expiresAt: new Date(now + TTL_MS),
    attempts: 0,
    lastSentAt: new Date(now),
  };
  await user.save();

  const logo = getLogoAttachment();
  const { html, text } = buildVerificationEmail({
    name: user.name,
    code,
    minutes: Math.round(TTL_MS / 60000),
    hasLogo: Boolean(logo),
  });

  const res = await sendEmail(user.email, "Confirm your LedgerWatch email", html, {
    text,
    attachments: logo ? [logo] : [],
  });

  if (!res.ok) {
    console.error(`[verify] could not send the code to ${user.email}: ${res.error}`);
    return { ok: false, reason: res.reason || "send-failed", error: res.error };
  }
  return { ok: true, expiresAt: user.emailVerification.expiresAt };
}

/**
 * Check a submitted code.
 *
 * Expiry is tested BEFORE the hash comparison, so an expired code reports as
 * expired rather than as wrong. Those are different problems with different
 * fixes, and telling somebody their correct code is invalid is the fastest way
 * to make them think the product is broken.
 */
async function checkCode(user, submitted) {
  const v = user.emailVerification || {};
  if (!v.codeHash || !v.expiresAt) {
    return { ok: false, reason: "no-code", error: "No confirmation code has been requested for this account." };
  }
  if (Date.now() > new Date(v.expiresAt).getTime()) {
    return {
      ok: false,
      reason: "expired",
      expired: true,
      error: "That code has expired. Please ask for a new one.",
    };
  }
  if ((v.attempts || 0) >= MAX_ATTEMPTS) {
    return {
      ok: false,
      reason: "too-many-attempts",
      expired: true,
      error: "Too many incorrect attempts. Please ask for a new code.",
    };
  }

  const match = await bcrypt.compare(String(submitted || "").trim(), v.codeHash);
  if (!match) {
    user.emailVerification.attempts = (v.attempts || 0) + 1;
    await user.save();
    const left = MAX_ATTEMPTS - user.emailVerification.attempts;
    return {
      ok: false,
      reason: "mismatch",
      error: left > 0 ? `That code is not correct. ${left} attempt${left === 1 ? "" : "s"} left.` : "That code is not correct.",
    };
  }

  user.emailVerified = true;
  user.emailVerification = { codeHash: null, expiresAt: null, attempts: 0, lastSentAt: v.lastSentAt };
  await user.save();
  return { ok: true };
}

module.exports = { issueCode, checkCode, generateCode, buildVerificationEmail, TTL_MS, RESEND_COOLDOWN_MS };
