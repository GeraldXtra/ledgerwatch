const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const accounts = require("../repositories/accounts");
const { isPlainAddress } = require("../utils/email");
const { renderActivityEmail, activityText } = require("../utils/emailBrand");

const CODE_LENGTH = 6;
const TTL_MS = 30 * 60 * 1000;
const MAX_ATTEMPTS = 6;
const RESEND_COOLDOWN_MS = 60 * 1000;
const SECURITY_REASON = "You receive this email because it concerns the security of your LedgerWatch account.";

function httpError(status, message, extra = {}) {
  const err = new Error(message);
  err.status = status;
  Object.assign(err, extra);
  return err;
}

function generateCode() {
  return String(crypto.randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, "0");
}

async function sendSecurityNotice(to, content) {
  const { sendEmail, getLogoAttachment } = require("./notify.service");
  const logo = getLogoAttachment();
  return sendEmail(
    to,
    content.subject,
    renderActivityEmail({ hasLogo: Boolean(logo), subtitle: "Account security", reason: SECURITY_REASON, ...content }),
    { text: activityText({ reason: SECURITY_REASON, ...content }), attachments: logo ? [logo] : [], category: "transactional" }
  );
}

async function startEmailChange(user, newEmail) {
  const address = accounts.normalizeEmail(newEmail);
  if (!isPlainAddress(address)) throw httpError(400, "Enter a valid email address.");
  if (address === accounts.normalizeEmail(user.email)) {
    throw httpError(400, "That is already the email you sign in with.");
  }
  if (await accounts.emailTaken(address, user._id)) {
    throw httpError(409, "That email is already used by another LedgerWatch account.");
  }
  const state = user.emailChange || {};
  const sinceLast = state.lastSentAt ? Date.now() - new Date(state.lastSentAt).getTime() : Infinity;
  if (state.newEmail === address && sinceLast < RESEND_COOLDOWN_MS) {
    const wait = Math.ceil((RESEND_COOLDOWN_MS - sinceLast) / 1000);
    throw httpError(429, `A code was sent a moment ago. You can ask for another in ${wait} seconds.`, { retryAfter: wait });
  }

  const code = generateCode();
  user.emailChange = {
    newEmail: address,
    codeHash: await bcrypt.hash(code, 10),
    expiresAt: new Date(Date.now() + TTL_MS),
    attempts: 0,
    lastSentAt: new Date(),
  };
  await user.save();

  const sent = await sendSecurityNotice(address, {
    subject: "Confirm your new LedgerWatch email",
    title: "Confirm your new email",
    intro: `Enter this code in LedgerWatch to sign in with ${address} from now on. It expires in 30 minutes.`,
    tone: "info",
    hero: { label: "Your code", value: code },
    footnote: "If you did not ask to change your email, ignore this message. Nothing changes until the code is entered.",
  });
  if (!sent.ok) {
    user.emailChange = {};
    await user.save();
    throw httpError(502, sent.error || "The code could not be sent to that address. Check it and try again.");
  }
  return { pendingEmail: address, expiresAt: user.emailChange.expiresAt };
}

async function confirmEmailChange(user, code) {
  const state = user.emailChange || {};
  if (!state.newEmail || !state.codeHash || !state.expiresAt) {
    throw httpError(400, "There is no email change waiting. Start again from Settings.");
  }
  if (new Date(state.expiresAt).getTime() <= Date.now()) {
    throw httpError(400, "That code has expired. Ask for a new one.", { expired: true });
  }
  const reserved = await accounts.reserveCodeAttempt(user._id, "emailChange", state.codeHash, MAX_ATTEMPTS);
  if (!reserved) {
    throw httpError(429, "Too many wrong codes. Ask for a new one.");
  }
  const match = await bcrypt.compare(String(code || "").replace(/\s+/g, ""), state.codeHash);
  if (!match) {
    throw httpError(400, "That code is not correct.");
  }
  if (await accounts.emailTaken(state.newEmail, user._id)) {
    throw httpError(409, "That email is already used by another LedgerWatch account.");
  }

  const oldEmail = user.email;
  user.email = state.newEmail;
  user.emailVerified = true;
  user.tokenVersion = (Number(user.tokenVersion) || 0) + 1;
  user.emailChange = {};
  try {
    await user.save();
  } catch (err) {
    if (err && err.code === 11000) throw httpError(409, "That email is already used by another LedgerWatch account.");
    throw err;
  }

  await sendSecurityNotice(oldEmail, {
    subject: "Your LedgerWatch sign-in email was changed",
    title: "Your sign-in email was changed",
    intro: `Your LedgerWatch account now signs in with ${user.email}. Every other device has been signed out.`,
    tone: "neg",
    footnote: "If you did not do this, reset your password from the sign in page straight away and reply to this email.",
  }).catch((err) => console.error("[email-change] notice to the old address failed:", err.message));

  return { email: user.email };
}

async function cancelEmailChange(user) {
  user.emailChange = {};
  await user.save();
  return { pendingEmail: null };
}

module.exports = { startEmailChange, confirmEmailChange, cancelEmailChange, sendSecurityNotice };
