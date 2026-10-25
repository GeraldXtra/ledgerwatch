const bcrypt = require("bcryptjs");
const QRCode = require("qrcode");
const accounts = require("../repositories/accounts");
const publicUser = require("../utils/publicUser");
const signToken = require("../utils/token");
const tf = require("../services/twoFactor.service");
const emailChange = require("../services/emailChange.service");

const PROTECTED_EMAIL = "demo@ledgerwatch.app";

function fail(res, err, fallback) {
  if (err && err.status) {
    const body = { error: err.message };
    if (err.retryAfter) body.retryAfter = err.retryAfter;
    if (err.expired) body.expired = true;
    return res.status(err.status).json(body);
  }
  console.error(`${fallback}:`, err && err.message);
  return res.status(500).json({ error: "That could not be done just now. Try again in a moment." });
}

function httpError(status, message, extra = {}) {
  const err = new Error(message);
  err.status = status;
  Object.assign(err, extra);
  return err;
}

async function accountWithSecrets(req) {
  const user = await accounts.findById(req.user._id);
  if (!user) throw httpError(401, "This account no longer exists.");
  return user;
}

async function requirePassword(user, password) {
  const ok = typeof password === "string" && password.length > 0 && (await bcrypt.compare(password, user.passwordHash));
  if (!ok) {
    throw httpError(
      400,
      user.authProvider === "google"
        ? "That password is not correct. If you sign in with Google, set a password first with Forgot password on the sign in page."
        : "That password is not correct."
    );
  }
}

async function requireSecondFactor(user, code) {
  const result = await tf.useSecondFactor(user._id, code);
  if (result.ok) return result;
  if (result.notEnabled) throw httpError(409, "Two-step sign-in is off.");
  if (result.locked) {
    throw httpError(429, `Too many wrong codes. Try again in ${Math.ceil(result.retryAfter / 60)} minutes.`, {
      retryAfter: result.retryAfter,
    });
  }
  throw httpError(
    400,
    result.secretUnreadable
      ? "Your authenticator code could not be checked on this server. Use one of your backup codes instead."
      : "That code is not correct. Check that your phone's clock is set automatically."
  );
}

function notify(user, title, intro) {
  emailChange
    .sendSecurityNotice(user.email, { subject: title, title, intro, tone: "info" })
    .catch((err) => console.error("[security] notice failed:", err.message));
}

async function twoFactorStatus(req, res) {
  try {
    const user = await accountWithSecrets(req);
    const state = user.twoFactor || {};
    return res.json({
      enabled: Boolean(state.enabled),
      enabledAt: state.enabledAt || null,
      backupCodesLeft: state.enabled ? (state.backupCodeHashes || []).length : 0,
    });
  } catch (err) {
    return fail(res, err, "two factor status error");
  }
}

async function twoFactorSetup(req, res) {
  try {
    if (String(req.user.email).toLowerCase() === PROTECTED_EMAIL) {
      throw httpError(403, "The shared demo account cannot turn on two-step sign-in.");
    }
    const user = await accountWithSecrets(req);
    if (user.twoFactor && user.twoFactor.enabled) throw httpError(409, "Two-step sign-in is already on.");
    await requirePassword(user, req.body.password);
    const secret = tf.newSecret();
    user.twoFactor = { ...(user.twoFactor || {}), pendingSecretEnc: tf.encryptSecret(secret), pendingCreatedAt: new Date() };
    await user.save();
    const otpauthUrl = tf.otpauthUrl(secret, user.email);
    const qr = await QRCode.toDataURL(otpauthUrl, { width: 220, margin: 1, errorCorrectionLevel: "M" });
    return res.json({ secret: tf.base32Encode(secret), otpauthUrl, qr });
  } catch (err) {
    return fail(res, err, "two factor setup error");
  }
}

async function twoFactorEnable(req, res) {
  try {
    const user = await accountWithSecrets(req);
    const state = user.twoFactor || {};
    if (state.enabled) throw httpError(409, "Two-step sign-in is already on.");
    const startedAt = state.pendingCreatedAt ? new Date(state.pendingCreatedAt).getTime() : 0;
    const pending = state.pendingSecretEnc && Date.now() - startedAt < tf.SETUP_TTL_MS ? tf.decryptSecret(state.pendingSecretEnc) : null;
    if (!pending) throw httpError(400, "This set up has expired. Start again.");
    const check = tf.verifyTotp(pending, req.body.code);
    if (!check.ok) throw httpError(400, "That code is not correct. Check that your phone's clock is set automatically.");

    const backupCodes = tf.newBackupCodes();
    const enabled = {
      enabled: true,
      secretEnc: state.pendingSecretEnc,
      pendingSecretEnc: null,
      pendingCreatedAt: null,
      backupCodeHashes: await tf.hashBackupCodes(backupCodes),
      lastUsedStep: check.step,
      failedAttempts: 0,
      lockedUntil: null,
      enabledAt: new Date(),
    };
    const saved = await accounts.enableTwoFactor(user._id, state.pendingSecretEnc, enabled);
    if (saved.modifiedCount !== 1) {
      throw httpError(409, "Two-step sign-in was turned on from another request. Use the backup codes shown there, or turn it off and on again.");
    }
    user.twoFactor = enabled;
    notify(user, "Two-step sign-in is on", "From now on, signing in to LedgerWatch asks for a code from your authenticator app as well as your password.");
    return res.json({ enabled: true, backupCodes, user: publicUser(user) });
  } catch (err) {
    return fail(res, err, "two factor enable error");
  }
}

async function twoFactorDisable(req, res) {
  try {
    const user = await accountWithSecrets(req);
    if (!user.twoFactor || !user.twoFactor.enabled) throw httpError(409, "Two-step sign-in is already off.");
    await requirePassword(user, req.body.password);
    await requireSecondFactor(user, req.body.code);
    user.twoFactor = {};
    await user.save();
    notify(user, "Two-step sign-in is off", "Signing in to LedgerWatch now needs only your password. If you did not turn this off, change your password straight away.");
    return res.json({ enabled: false, user: publicUser(user) });
  } catch (err) {
    return fail(res, err, "two factor disable error");
  }
}

async function twoFactorBackupCodes(req, res) {
  try {
    const user = await accountWithSecrets(req);
    if (!user.twoFactor || !user.twoFactor.enabled) throw httpError(409, "Two-step sign-in is off.");
    await requireSecondFactor(user, req.body.code);
    const backupCodes = tf.newBackupCodes();
    user.twoFactor.backupCodeHashes = await tf.hashBackupCodes(backupCodes);
    await user.save();
    return res.json({ backupCodes });
  } catch (err) {
    return fail(res, err, "two factor backup codes error");
  }
}

async function emailChangeStart(req, res) {
  try {
    if (String(req.user.email).toLowerCase() === PROTECTED_EMAIL) {
      throw httpError(403, "The shared demo account cannot change its email.");
    }
    const user = await accountWithSecrets(req);
    await requirePassword(user, req.body.password);
    if (user.twoFactor && user.twoFactor.enabled) await requireSecondFactor(user, req.body.code);
    const out = await emailChange.startEmailChange(user, req.body.newEmail);
    return res.json({ ...out, user: publicUser(user) });
  } catch (err) {
    return fail(res, err, "email change start error");
  }
}

async function emailChangeConfirm(req, res) {
  try {
    const user = await accountWithSecrets(req);
    await emailChange.confirmEmailChange(user, req.body.code);
    return res.json({ token: signToken(user._id, user.tokenVersion), user: publicUser(user) });
  } catch (err) {
    return fail(res, err, "email change confirm error");
  }
}

async function emailChangeCancel(req, res) {
  try {
    const user = await accountWithSecrets(req);
    await emailChange.cancelEmailChange(user);
    return res.json({ pendingEmail: null, user: publicUser(user) });
  } catch (err) {
    return fail(res, err, "email change cancel error");
  }
}

module.exports = {
  twoFactorStatus,
  twoFactorSetup,
  twoFactorEnable,
  twoFactorDisable,
  twoFactorBackupCodes,
  emailChangeStart,
  emailChangeConfirm,
  emailChangeCancel,
};
