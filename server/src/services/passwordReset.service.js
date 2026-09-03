const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { sendEmail, getLogoAttachment } = require("./notify.service");

/**
 * Password reset codes.
 *
 * DELIBERATELY A SEPARATE STATE FROM EMAIL VERIFICATION, in its own sub document
 * on the user, with its own service. The two look alike (six digits, a TTL, an
 * attempt cap) and it would be tempting to reuse `emailVerification`. That would
 * let a reset code confirm an email address, and a verification code change a
 * password, because the check would have no way to tell which purpose a given
 * hash was minted for. A credential that can do two things is two credentials
 * with one set of defences.
 *
 * Six digits, fifteen minutes, hashed at rest, capped attempts, throttled
 * resends. A reset code is a credential that hands over the account, so it is
 * treated exactly like the password it replaces.
 */

const CODE_LENGTH = 6;
const TTL_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 6;
const RESEND_COOLDOWN_MS = 60 * 1000;
const SALT_ROUNDS = 10;

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
 * The reset email. Nested tables, inlined styles, logo by content id, and no
 * dashes or hyphens anywhere in the copy, all for the same reasons as the
 * verification email beside it.
 */
function buildResetEmail({ name, code, minutes, hasLogo }) {
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
<title>Reset your LedgerWatch password</title></head>
<body style="margin:0;padding:0;background:#f2f5f9;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">
  Your LedgerWatch password reset code is ${esc(code)}. It expires in ${minutes} minutes.
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
       Reset your password
     </div>
     <div style="font-size:25px;font-weight:700;color:#0a1428;margin-top:10px;line-height:1.25;">
       Hello ${esc(first)}, here is your code
     </div>
     <div style="font-size:15px;line-height:1.65;color:#3a4658;margin-top:14px;">
       Somebody asked to reset the password on your LedgerWatch account. Enter the code below on
       the reset screen and you will be asked to choose a new password.
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

   <tr><td style="padding:0 32px 30px 32px;font-family:Helvetica,Arial,sans-serif;
                  font-size:12.5px;line-height:1.7;color:#64748b;border-top:1px solid #e1e7f0;padding-top:20px;">
     If you did not ask for this, you can ignore this message and your password will stay as it
     is. Nobody can use this code without access to your mailbox.<br /><br />
     <span style="color:#94a3b8;">LedgerWatch. Sent because somebody asked to reset the password for this address.</span>
   </td></tr>

  </table>
 </td></tr>
</table>
</body></html>`;

  const text = [
    `Hello ${first}, here is your code.`,
    "",
    `Your LedgerWatch password reset code is: ${code}`,
    "",
    `This code expires in ${minutes} minutes.`,
    "",
    "Enter it on the reset screen and you will be asked to choose a new password.",
    "",
    "If you did not ask for this, ignore this message and your password will stay as it is.",
  ].join("\n");

  return { html, text };
}

/**
 * Mint a reset code, store its hash on `user.passwordReset`, and email it.
 * The plain code exists only here and in the email.
 */
async function issueResetCode(user, { force = false } = {}) {
  const now = Date.now();
  const last = user.passwordReset?.lastSentAt;
  if (!force && last && now - new Date(last).getTime() < RESEND_COOLDOWN_MS) {
    const wait = Math.ceil((RESEND_COOLDOWN_MS - (now - new Date(last).getTime())) / 1000);
    return {
      ok: false,
      reason: "cooldown",
      retryAfter: wait,
      error: `Please wait ${wait} seconds before asking for another code.`,
    };
  }

  const code = generateCode();
  user.passwordReset = {
    codeHash: await bcrypt.hash(code, SALT_ROUNDS),
    expiresAt: new Date(now + TTL_MS),
    attempts: 0,
    lastSentAt: new Date(now),
  };
  await user.save();

  const logo = getLogoAttachment();
  const { html, text } = buildResetEmail({
    name: user.name,
    code,
    minutes: Math.round(TTL_MS / 60000),
    hasLogo: Boolean(logo),
  });

  const res = await sendEmail(user.email, "Reset your LedgerWatch password", html, {
    text,
    attachments: logo ? [logo] : [],
  });

  if (!res.ok) {
    console.error(`[reset] could not send the code to ${user.email}: ${res.error}`);
    return { ok: false, reason: res.reason || "send-failed", error: res.error };
  }
  return { ok: true, expiresAt: user.passwordReset.expiresAt };
}

/**
 * Check a submitted reset code.
 *
 * Unlike the verification check, a match here does NOT clear the state. The
 * code is only spent once the new password has actually been written, so a
 * failure between "code accepted" and "password saved" leaves the person able
 * to try again rather than locked out with a code that no longer exists.
 * `clearResetState` is called by the controller after the save.
 */
async function checkResetCode(user, submitted) {
  const v = user.passwordReset || {};
  if (!v.codeHash || !v.expiresAt) {
    return {
      ok: false,
      reason: "no-code",
      error: "No reset code has been requested for this account.",
    };
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
    user.passwordReset.attempts = (v.attempts || 0) + 1;
    await user.save();
    const left = MAX_ATTEMPTS - user.passwordReset.attempts;
    return {
      ok: false,
      reason: "mismatch",
      error:
        left > 0
          ? `That code is not correct. ${left} attempt${left === 1 ? "" : "s"} left.`
          : "That code is not correct.",
    };
  }

  return { ok: true };
}

/** Spend the code. Called only after the new password has been saved. */
function clearResetState(user) {
  user.passwordReset = {
    codeHash: null,
    expiresAt: null,
    attempts: 0,
    lastSentAt: user.passwordReset?.lastSentAt || null,
  };
}

module.exports = {
  issueResetCode,
  checkResetCode,
  clearResetState,
  buildResetEmail,
  TTL_MS,
  RESEND_COOLDOWN_MS,
};
