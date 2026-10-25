const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const accounts = require("../repositories/accounts");

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_SECONDS = 30;
const DIGITS = 6;
const WINDOW = 1;
const BACKUP_CODES = 10;
const BACKUP_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const BACKUP_LENGTH = 10;
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const SETUP_TTL_MS = 15 * 60 * 1000;
const CHALLENGE_TTL = "5m";

function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(text) {
  const clean = String(text || "").toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    value = (value << 5) | ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function hotp(secret, counter) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = crypto.createHmac("sha1", secret).update(msg).digest();
  const offset = mac[mac.length - 1] & 15;
  const code = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS;
  return String(code).padStart(DIGITS, "0");
}

function currentStep(nowMs = Date.now()) {
  return Math.floor(nowMs / 1000 / STEP_SECONDS);
}

function totp(secret, nowMs = Date.now()) {
  return hotp(secret, currentStep(nowMs));
}

function sameCode(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function verifyTotp(secret, code, { lastUsedStep = 0, nowMs = Date.now() } = {}) {
  const given = String(code || "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(given)) return { ok: false };
  const now = currentStep(nowMs);
  for (let delta = -WINDOW; delta <= WINDOW; delta++) {
    const step = now + delta;
    if (step <= lastUsedStep) continue;
    if (sameCode(hotp(secret, step), given)) return { ok: true, step };
  }
  return { ok: false };
}

function key(label) {
  return crypto.hkdfSync("sha256", Buffer.from(String(process.env.JWT_SECRET || "")), Buffer.from("ledgerwatch-2fa"), Buffer.from(label), 32);
}

function encryptSecret(secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", Buffer.from(key("totp-secret-v1")), iv);
  const body = Buffer.concat([cipher.update(secret), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

function decryptSecret(stored) {
  const [version, iv, tag, body] = String(stored || "").split(".");
  if (version !== "v1" || !iv || !tag || !body) return null;
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", Buffer.from(key("totp-secret-v1")), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]);
  } catch {
    return null;
  }
}

function newSecret() {
  return crypto.randomBytes(20);
}

function otpauthUrl(secret, email) {
  const label = encodeURIComponent(`LedgerWatch:${email}`);
  return `otpauth://totp/${label}?secret=${base32Encode(secret)}&issuer=LedgerWatch&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

function newBackupCodes() {
  return Array.from({ length: BACKUP_CODES }, () =>
    Array.from({ length: BACKUP_LENGTH }, () => BACKUP_ALPHABET[crypto.randomInt(0, BACKUP_ALPHABET.length)]).join("")
  );
}

function normalizeBackupCode(code) {
  return String(code || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function hashBackupCodes(codes) {
  return Promise.all(codes.map((c) => bcrypt.hash(normalizeBackupCode(c), 10)));
}

async function matchBackupCode(hashes, code) {
  const given = normalizeBackupCode(code);
  if (given.length !== BACKUP_LENGTH) return -1;
  for (let i = 0; i < (hashes || []).length; i++) {
    if (await bcrypt.compare(given, hashes[i])) return i;
  }
  return -1;
}

function challengeKey() {
  return Buffer.from(key("login-challenge-v1")).toString("base64");
}

function issueChallenge(user) {
  return jwt.sign({ uid: String(user._id), v: Number(user.tokenVersion) || 0, purpose: "two-factor" }, challengeKey(), {
    algorithm: "HS256",
    expiresIn: CHALLENGE_TTL,
    audience: "ledgerwatch-2fa",
  });
}

function readChallenge(token) {
  try {
    const claims = jwt.verify(String(token || ""), challengeKey(), { algorithms: ["HS256"], audience: "ledgerwatch-2fa" });
    return claims && claims.purpose === "two-factor" && claims.uid ? claims : null;
  } catch {
    return null;
  }
}

function lockedFor(state, nowMs = Date.now()) {
  const until = state && state.lockedUntil ? new Date(state.lockedUntil).getTime() : 0;
  return until > nowMs ? Math.ceil((until - nowMs) / 1000) : 0;
}

async function useSecondFactor(userId, code, nowMs = Date.now()) {
  const now = new Date(nowMs);
  const lockUntil = new Date(nowMs + LOCK_MINUTES * 60 * 1000);
  const reserved = await accounts.reserveSecondFactorAttempt(userId, now, MAX_FAILED);
  if (!reserved) {
    const current = await accounts.findById(userId).select("twoFactor.enabled twoFactor.lockedUntil").lean();
    if (!current || !current.twoFactor || !current.twoFactor.enabled) return { ok: false, notEnabled: true };
    const wait = lockedFor(current.twoFactor, nowMs);
    if (wait) return { ok: false, locked: true, retryAfter: wait };
    await accounts.lockStalledSecondFactor(userId, now, lockUntil, MAX_FAILED);
    return { ok: false, locked: true, retryAfter: LOCK_MINUTES * 60 };
  }

  const state = reserved.twoFactor || {};
  const secret = decryptSecret(state.secretEnc);
  const totpResult = secret ? verifyTotp(secret, code, { lastUsedStep: state.lastUsedStep || 0, nowMs }) : { ok: false };
  if (totpResult.ok && (await accounts.acceptTotpStep(userId, totpResult.step)).modifiedCount === 1) {
    return { ok: true, method: "app" };
  }

  const used = await matchBackupCode(state.backupCodeHashes, code);
  if (used >= 0) {
    const after = await accounts.acceptBackupCode(userId, state.backupCodeHashes[used]);
    if (after) return { ok: true, method: "backup", backupCodesLeft: ((after.twoFactor || {}).backupCodeHashes || []).length };
  }

  const failures = Number(state.failedAttempts) || 0;
  if (failures >= MAX_FAILED) {
    await accounts.lockSecondFactor(userId, lockUntil);
    return { ok: false, locked: true, retryAfter: LOCK_MINUTES * 60 };
  }
  return { ok: false, secretUnreadable: !secret, attemptsLeft: MAX_FAILED - failures };
}

module.exports = {
  base32Encode,
  base32Decode,
  hotp,
  totp,
  verifyTotp,
  currentStep,
  encryptSecret,
  decryptSecret,
  newSecret,
  otpauthUrl,
  newBackupCodes,
  hashBackupCodes,
  matchBackupCode,
  issueChallenge,
  readChallenge,
  useSecondFactor,
  lockedFor,
  SETUP_TTL_MS,
  BACKUP_CODES,
};
