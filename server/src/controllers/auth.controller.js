const bcrypt = require("bcryptjs");
const User = require("../models/User");
const Portfolio = require("../models/Portfolio");
const signToken = require("../utils/token");
const publicUser = require("../utils/publicUser");
const { buildCryptoUpdate } = require("../services/cryptoSettings.service");
const { verifyTurnstile } = require("../services/turnstile.service");
const { issueCode, checkCode } = require("../services/emailVerification.service");

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SALT_ROUNDS = 10;

/**
 * POST /api/auth/register
 * Body: { name, email, password, bankDetails? }
 * Creates the user (hashed password) and auto-creates their sim Portfolio.
 * Returns { token, user }.
 */
async function register(req, res) {
  try {
    const { name, email, password, bankDetails, turnstileToken } = req.body || {};

    // Human check first, before any database work. A bot that cannot pass this
    // should not be able to make us hash a password or probe which emails exist.
    const human = await verifyTurnstile(turnstileToken, req.ip);
    if (!human.ok) return res.status(400).json({ error: human.error, turnstile: true });

    // Validation
    if (!name || !email || !password) {
      return res.status(400).json({ error: "name, email and password are required" });
    }
    if (!EMAIL_REGEX.test(email)) {
      return res.status(400).json({ error: "Invalid email format" });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    const normalizedEmail = String(email).toLowerCase().trim();

    // Duplicate email pre-check
    const existing = await User.findOne({ email: normalizedEmail });
    if (existing) {
      return res.status(409).json({ error: "Email already registered" });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const user = await User.create({
      name,
      email: normalizedEmail,
      passwordHash,
      bankDetails: bankDetails || {},
      emailVerified: false,
    });

    // Auto-create the user's sim Portfolio (cashBalance default 1,000,000).
    await Portfolio.create({ userId: user._id });

    /**
     * NO TOKEN YET. The account exists but cannot be used until the code that
     * has just been emailed is entered. Returning a session here would make the
     * verification step decorative, which is the usual way this control ends up
     * proving nothing.
     */
    const sent = await issueCode(user);
    if (!sent.ok) {
      // The account was created and the code was not delivered. Say so plainly
      // and point at the resend, rather than leaving somebody staring at a code
      // screen waiting for mail that is never coming.
      return res.status(201).json({
        verificationRequired: true,
        email: user.email,
        emailSent: false,
        error: sent.error || "We could not send the confirmation code. Please request a new one.",
      });
    }

    return res.status(201).json({
      verificationRequired: true,
      email: user.email,
      emailSent: true,
      expiresAt: sent.expiresAt,
    });
  } catch (err) {
    // Safety net for the unique index race.
    if (err && err.code === 11000) {
      return res.status(409).json({ error: "Email already registered" });
    }
    console.error("register error:", err.message);
    return res.status(500).json({ error: "Registration failed" });
  }
}

/**
 * POST /api/auth/login
 * Body: { email, password }
 * Returns { token, user }.
 */
async function login(req, res) {
  try {
    const { email, password, turnstileToken } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ error: "email and password are required" });
    }

    const human = await verifyTurnstile(turnstileToken, req.ip);
    if (!human.ok) return res.status(400).json({ error: human.error, turnstile: true });

    const normalizedEmail = String(email).toLowerCase().trim();
    const user = await User.findOne({ email: normalizedEmail });

    // Same generic message whether the user is missing or the password is wrong.
    if (!user) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    /**
     * An unverified account cannot sign in. Accounts that predate verification
     * have `emailVerified` false with no code ever issued, so they are treated as
     * grandfathered rather than locked out of their own ledger.
     */
    const neverIssued = !user.emailVerification || !user.emailVerification.lastSentAt;
    if (!user.emailVerified && !neverIssued) {
      const sent = await issueCode(user);
      return res.status(403).json({
        verificationRequired: true,
        email: user.email,
        emailSent: sent.ok,
        error: "Please confirm your email address. We have sent you a new code.",
      });
    }

    const token = signToken(user._id);
    return res.status(200).json({ token, user: publicUser(user) });
  } catch (err) {
    console.error("login error:", err.message);
    return res.status(500).json({ error: "Login failed" });
  }
}

/**
 * GET /api/auth/me  (protected)
 * Returns { user }.
 */
async function me(req, res) {
  return res.status(200).json({ user: publicUser(req.user) });
}

/**
 * PATCH /api/auth/me  (protected)
 * Updates the logged-in user's name and/or bankDetails. Returns { user }.
 */
async function updateMe(req, res) {
  try {
    const { name, companyName, bankDetails, autoSend, notifyPrefs, crypto } = req.body || {};
    const updates = {};

    if (typeof name === "string" && name.trim()) {
      updates.name = name.trim();
    }
    // Company name may be intentionally cleared, so an empty string is valid.
    if (typeof companyName === "string") {
      updates.companyName = companyName.trim();
    }
    if (bankDetails && typeof bankDetails === "object") {
      updates.bankDetails = {
        accountName: bankDetails.accountName,
        accountNumber: bankDetails.accountNumber,
        bankName: bankDetails.bankName,
      };
    }
    if (notifyPrefs && typeof notifyPrefs === "object") {
      updates.notifyPrefs = {
        marketAlerts: notifyPrefs.marketAlerts !== false,
        remindersDue: notifyPrefs.remindersDue !== false,
        txUpdates: notifyPrefs.txUpdates !== false,
      };
    }
    // Opt-in automatic reminder delivery. Coerced to booleans so a stray value can't
    // enable a channel unexpectedly.
    if (autoSend && typeof autoSend === "object") {
      updates.autoSend = {
        enabled: Boolean(autoSend.enabled),
        whatsapp: Boolean(autoSend.whatsapp),
        email: Boolean(autoSend.email),
      };
    }

    // Crypto payment settings. Validated and clamped in one place, because a bad
    // sweep destination or a confirmation depth of zero costs real money — see
    // buildCryptoUpdate. It uses dotted paths so one field can be saved without
    // wiping the derivation counter that lives in the same sub-document.
    if (crypto && typeof crypto === "object") {
      Object.assign(updates, buildCryptoUpdate(crypto));
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        error:
          "Nothing to update (provide name, companyName, bankDetails, autoSend, notifyPrefs and/or crypto)",
      });
    }

    const user = await User.findByIdAndUpdate(req.user._id, updates, {
      new: true,
      runValidators: true,
    }).select("-passwordHash");

    return res.status(200).json({ user: publicUser(user) });
  } catch (err) {
    // Validation failures carry their own status and a message written for the
    // user. Reporting "a bad sweep address" as a 500 would be both wrong and
    // unhelpful.
    if (err && err.status) return res.status(err.status).json({ error: err.message });
    console.error("updateMe error:", err.message);
    return res.status(500).json({ error: "Update failed" });
  }
}

/**
 * POST /api/auth/verify-email
 * Body: { email, code }
 * On success the account is verified and a session is issued, so the person is
 * signed straight in rather than being sent back to a login form they have just
 * proven they can pass.
 */
async function verifyEmailCode(req, res) {
  try {
    const { email, code } = req.body || {};
    if (!email || !code) return res.status(400).json({ error: "email and code are required" });

    const user = await User.findOne({ email: String(email).toLowerCase().trim() });
    // Same shape whether the account is missing or the code is wrong, so this
    // endpoint cannot be used to discover which addresses are registered.
    if (!user) return res.status(400).json({ error: "That code is not correct." });

    if (user.emailVerified) {
      return res.status(200).json({ token: signToken(user._id), user: publicUser(user), alreadyVerified: true });
    }

    const result = await checkCode(user, code);
    if (!result.ok) {
      return res.status(400).json({ error: result.error, expired: Boolean(result.expired), reason: result.reason });
    }

    return res.status(200).json({ token: signToken(user._id), user: publicUser(user) });
  } catch (err) {
    console.error("verify email error:", err.message);
    return res.status(500).json({ error: "Could not confirm that code" });
  }
}

/**
 * POST /api/auth/resend-code
 * Body: { email }
 * Always answers the same way whether or not the address exists, so it cannot be
 * used to enumerate accounts. The cooldown lives in the service.
 */
async function resendVerificationCode(req, res) {
  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: "email is required" });

    const user = await User.findOne({ email: String(email).toLowerCase().trim() });
    const generic = { ok: true, message: "If that address needs confirming, a new code is on its way." };

    if (!user || user.emailVerified) return res.status(200).json(generic);

    const sent = await issueCode(user);
    if (!sent.ok && sent.reason === "cooldown") {
      return res.status(429).json({ error: sent.error, retryAfter: sent.retryAfter });
    }
    if (!sent.ok) return res.status(502).json({ error: sent.error || "Could not send the code." });

    return res.status(200).json({ ...generic, expiresAt: sent.expiresAt });
  } catch (err) {
    console.error("resend code error:", err.message);
    return res.status(500).json({ error: "Could not send a new code" });
  }
}

module.exports = {
  verifyEmailCode,
  resendVerificationCode, register, login, me, updateMe };
