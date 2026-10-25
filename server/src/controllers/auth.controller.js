const bcrypt = require("bcryptjs");
const accounts = require("../repositories/accounts");
const { scopedRepo } = require("../repositories/scoped");
const signToken = require("../utils/token");
const publicUser = require("../utils/publicUser");
const { buildCryptoUpdate } = require("../services/cryptoSettings.service");
const { verifyTurnstile } = require("../services/turnstile.service");
const { issueCode, checkCode } = require("../services/emailVerification.service");
const {
  issueResetCode,
  checkResetCode,
  clearResetState,
} = require("../services/passwordReset.service");

const SALT_ROUNDS = 12;
const { isPlainAddress } = require("../utils/email");
const { accountLocked, noteFailedLogin, clearFailedLogins, passwordProblem } = require("../middleware/security");
const { NOTIFY_PREF_KEYS } = require("../utils/notifyPrefs");
const tf = require("../services/twoFactor.service");
const MAX_NAME_LENGTH = 80;
const DUMMY_HASH = bcrypt.hashSync("not-a-password", SALT_ROUNDS);

async function register(req, res) {
  try {
    const { name, email, password, bankDetails, turnstileToken } = req.body;

    const human = await verifyTurnstile(turnstileToken, req.ip);
    if (!human.ok) return res.status(400).json({ error: human.error, turnstile: true });

    if (!name || !email || !password) {
      return res.status(400).json({ error: "name, email and password are required" });
    }
    if (typeof name !== "string" || typeof email !== "string" || typeof password !== "string") {
      return res.status(400).json({ error: "name, email and password must be text" });
    }
    if (!isPlainAddress(email)) {
      return res.status(400).json({ error: "Invalid email format" });
    }
    const weak = passwordProblem(password, { email, name });
    if (weak) return res.status(400).json({ error: weak });
    if (String(name).trim().length > MAX_NAME_LENGTH) {
      return res.status(400).json({ error: `Name must be ${MAX_NAME_LENGTH} characters or fewer` });
    }

    const normalizedEmail = String(email).toLowerCase().trim();

    const existing = await accounts.findByEmail(normalizedEmail);
    if (existing) {
      return res.status(409).json({ error: "Email already registered" });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const cleanBank = {};
    if (bankDetails && typeof bankDetails === "object") {
      for (const key of ["bankName", "accountName", "accountNumber"]) {
        if (typeof bankDetails[key] === "string") cleanBank[key] = bankDetails[key].trim().slice(0, 120);
      }
    }

    const user = await accounts.create({
      name: name.trim(),
      email: normalizedEmail,
      passwordHash,
      bankDetails: cleanBank,
      emailVerified: false,
    });

    await scopedRepo(user._id).portfolios.create({});

    const sent = await issueCode(user);
    if (!sent.ok) {
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
    if (err && err.code === 11000) {
      return res.status(409).json({ error: "Email already registered" });
    }
    console.error("register error:", err.message);
    return res.status(500).json({ error: "Registration failed" });
  }
}

async function login(req, res) {
  try {
    const { email, password, turnstileToken } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "email and password are required" });
    }

    const human = await verifyTurnstile(turnstileToken, req.ip);
    if (!human.ok) return res.status(400).json({ error: human.error, turnstile: true });

    const normalizedEmail = String(email).toLowerCase().trim();
    const lockedFor = accountLocked(normalizedEmail);
    if (lockedFor) {
      res.setHeader("Retry-After", String(lockedFor));
      return res.status(429).json({
        error:
          "Too many wrong passwords for this account. Wait fifteen minutes, or reset your password from the sign in page.",
        retryAfter: lockedFor,
        code: "account_locked",
      });
    }

    const user = await accounts.findByEmail(normalizedEmail);

    const hash = user ? user.passwordHash : DUMMY_HASH;
    const match = await bcrypt.compare(String(password).slice(0, 256), hash);
    if (!user || !match) {
      noteFailedLogin(normalizedEmail);
      return res.status(401).json({ error: "Invalid email or password" });
    }
    clearFailedLogins(normalizedEmail);

    if (bcrypt.getRounds(user.passwordHash) < SALT_ROUNDS) {
      const stronger = await bcrypt.hash(String(password), SALT_ROUNDS);
      await accounts.upgradePasswordHash(user._id, user.passwordHash, stronger).catch(
        (err) => console.error("login rehash failed:", err.message)
      );
    }

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

    if (user.twoFactor && user.twoFactor.enabled) {
      return res.status(200).json({ twoFactorRequired: true, challenge: tf.issueChallenge(user) });
    }

    const token = signToken(user._id, user.tokenVersion);
    return res.status(200).json({ token, user: publicUser(user) });
  } catch (err) {
    console.error("login error:", err.message);
    return res.status(500).json({ error: "Login failed" });
  }
}

async function loginSecondFactor(req, res) {
  try {
    const claims = tf.readChallenge(req.body.challenge);
    const signInAgain = { error: "This sign in has expired. Enter your email and password again.", restart: true };
    if (!claims) return res.status(401).json(signInAgain);
    const user = await accounts.findById(claims.uid);
    if (!user || !user.twoFactor || !user.twoFactor.enabled || (Number(user.tokenVersion) || 0) !== claims.v) {
      return res.status(401).json(signInAgain);
    }
    const result = await tf.useSecondFactor(user._id, req.body.code);
    if (result.notEnabled) return res.status(401).json(signInAgain);
    if (result.locked) {
      res.setHeader("Retry-After", String(result.retryAfter));
      return res.status(429).json({
        error: `Too many wrong codes. Wait ${Math.ceil(result.retryAfter / 60)} minutes, then sign in again.`,
        retryAfter: result.retryAfter,
        restart: true,
      });
    }
    if (!result.ok) {
      return res.status(400).json({
        error: result.secretUnreadable
          ? "Your authenticator code could not be checked on this server. Use one of your backup codes instead."
          : `That code is not correct. ${result.attemptsLeft} attempt${result.attemptsLeft === 1 ? "" : "s"} left.`,
      });
    }
    clearFailedLogins(user.email);
    return res.status(200).json({
      token: signToken(user._id, user.tokenVersion),
      user: publicUser(user),
      ...(result.method === "backup" ? { backupCodesLeft: result.backupCodesLeft } : {}),
    });
  } catch (err) {
    console.error("login second factor error:", err.message);
    return res.status(500).json({ error: "Sign in failed. Try again in a moment." });
  }
}

async function forgotPassword(req, res) {
  try {
    const { email, turnstileToken } = req.body;
    if (!email) return res.status(400).json({ error: "email is required" });

    const human = await verifyTurnstile(turnstileToken, req.ip);
    if (!human.ok) return res.status(400).json({ error: human.error, turnstile: true });

    const generic = {
      ok: true,
      message:
        "If that address has an account, a code is on its way. If you asked a moment ago, give it a minute before asking again.",
    };
    const user = await accounts.findByEmail(email);
    if (!user) return res.status(200).json(generic);

    const sent = await issueResetCode(user);
    if (!sent.ok && sent.reason === "cooldown") return res.status(200).json(generic);
    if (!sent.ok) return res.status(200).json({ ...generic, emailSent: false });
    return res.status(200).json({ ...generic, expiresAt: sent.expiresAt });
  } catch (err) {
    console.error("forgot password error:", err.message);
    return res.status(500).json({ error: "Could not start the password reset" });
  }
}

async function resendResetCode(req, res) {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "email is required" });
    const generic = {
      ok: true,
      message:
        "If that address has an account, a new code is on its way. If you asked a moment ago, give it a minute.",
    };
    const user = await accounts.findByEmail(email);
    if (!user) return res.status(200).json(generic);
    const sent = await issueResetCode(user);
    return res.status(200).json({ ...generic, emailSent: sent.ok });
  } catch (err) {
    console.error("resend reset code error:", err.message);
    return res.status(500).json({ error: "Could not send a new code" });
  }
}

async function resetPassword(req, res) {
  try {
    const { email, code, newPassword } = req.body;
    if (!email || !code || !newPassword) {
      return res.status(400).json({ error: "email, code and newPassword are required" });
    }
    const weak = passwordProblem(newPassword, { email: String(email) });
    if (weak) return res.status(400).json({ error: weak });

    const user = await accounts.findByEmail(email);
    if (!user) return res.status(400).json({ error: "That code is not correct." });

    const check = await checkResetCode(user, code);
    if (!check.ok) {
      return res.status(400).json({
        error: check.error,
        expired: Boolean(check.expired),
        reason: check.reason,
      });
    }

    const unchanged = await bcrypt.compare(String(newPassword), user.passwordHash);
    if (unchanged) {
      return res.status(400).json({
        error: "That is already your password. Choose a different one.",
        reason: "same-password",
      });
    }

    user.passwordHash = await bcrypt.hash(String(newPassword), SALT_ROUNDS);
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    clearResetState(user);
    await user.save();
    clearFailedLogins(user.email);

    return res.status(200).json({
      ok: true,
      message: "Your password has been changed. Please sign in with it.",
    });
  } catch (err) {
    console.error("reset password error:", err.message);
    return res.status(500).json({ error: "Could not change the password" });
  }
}

async function me(req, res) {
  const withAvatar = await scopedRepo(req.user._id).self.get("avatarUrl").lean();
  const user = publicUser(req.user);
  if (user && withAvatar) user.avatarUrl = withAvatar.avatarUrl || null;
  return res.status(200).json({ user });
}

async function updateMe(req, res) {
  try {
    const { name, companyName, bankDetails, autoSend, notifyPrefs, crypto } = req.body;
    const updates = {};

    if (typeof name === "string" && name.trim()) {
      if (name.trim().length > MAX_NAME_LENGTH) {
        return res.status(400).json({ error: `Name must be ${MAX_NAME_LENGTH} characters or fewer` });
      }
      updates.name = name.trim();
    }
    if (typeof companyName === "string") {
      updates.companyName = companyName.trim().slice(0, 120);
    }
    if (bankDetails && typeof bankDetails === "object") {
      for (const key of ["accountName", "accountNumber", "bankName"]) {
        if (typeof bankDetails[key] === "string") {
          updates[`bankDetails.${key}`] = bankDetails[key].trim().slice(0, 120);
        }
      }
    }
    if (notifyPrefs && typeof notifyPrefs === "object") {
      for (const key of NOTIFY_PREF_KEYS) {
        if (key in notifyPrefs) updates[`notifyPrefs.${key}`] = notifyPrefs[key] !== false;
      }
    }
    if (autoSend && typeof autoSend === "object") {
      updates.autoSend = {
        enabled: Boolean(autoSend.enabled),
        whatsapp: Boolean(autoSend.whatsapp),
        email: Boolean(autoSend.email),
      };
    }

    if (crypto && typeof crypto === "object") {
      Object.assign(updates, buildCryptoUpdate(crypto));
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        error:
          "Nothing to update (provide name, companyName, bankDetails, autoSend, notifyPrefs and/or crypto)",
      });
    }

    const user = await scopedRepo(req.user._id).self.update({ $set: updates }, { runValidators: true }).select("-passwordHash");

    return res.status(200).json({ user: publicUser(user) });
  } catch (err) {
    if (err && err.status) return res.status(err.status).json({ error: err.message });
    console.error("updateMe error:", err.message);
    return res.status(500).json({ error: "Update failed" });
  }
}

async function verifyEmailCode(req, res) {
  try {
    const { email, code } = req.body;
    if (!email || !code) return res.status(400).json({ error: "email and code are required" });

    const user = await accounts.findByEmail(email);

    const notCorrect = {
      error: "That code is not correct. If you have already confirmed this address, sign in instead.",
    };
    if (!user || user.emailVerified) return res.status(400).json(notCorrect);

    const result = await checkCode(user, code);
    if (!result.ok) {
      return res.status(400).json({ error: result.error, expired: Boolean(result.expired), reason: result.reason });
    }

    return res.status(200).json({ token: signToken(user._id, user.tokenVersion), user: publicUser(user) });
  } catch (err) {
    console.error("verify email error:", err.message);
    return res.status(500).json({ error: "Could not confirm that code" });
  }
}

async function resendVerificationCode(req, res) {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "email is required" });

    const user = await accounts.findByEmail(email);
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
  register,
  login,
  loginSecondFactor,
  me,
  updateMe,
  verifyEmailCode,
  resendVerificationCode,
  forgotPassword,
  resendResetCode,
  resetPassword,
};
