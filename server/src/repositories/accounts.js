const User = require("../models/User");
const { ownerId } = require("./scoped");

const CODE_KINDS = new Set(["passwordReset", "emailVerification", "emailChange"]);

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

module.exports = {
  normalizeEmail,
  findById: (id, projection, options) => User.findById(ownerId(id), projection, options),
  findByEmail: (email, projection, options) => User.findOne({ email: normalizeEmail(email) }, projection, options),
  findByGoogleId: (googleId, projection, options) => User.findOne({ googleId: String(googleId) }, projection, options),
  findByGoogleIdOrEmail: (googleId, email, projection, options) =>
    User.findOne({ $or: [{ googleId: String(googleId) }, { email: normalizeEmail(email) }] }, projection, options),
  upgradePasswordHash: (id, fromHash, toHash) =>
    User.updateOne({ _id: ownerId(id), passwordHash: fromHash }, { $set: { passwordHash: toHash } }),
  emailTaken: (email, exceptId) =>
    User.exists({ email: normalizeEmail(email), ...(exceptId ? { _id: { $ne: ownerId(exceptId) } } : {}) }),
  create: (fields) => User.create(fields),
  deleteById: (id) => User.deleteOne({ _id: ownerId(id) }),
  reserveSecondFactorAttempt: (id, now, maxFailed) =>
    User.findOneAndUpdate(
      {
        _id: ownerId(id),
        "twoFactor.enabled": true,
        "twoFactor.failedAttempts": { $not: { $gte: maxFailed } },
        $or: [{ "twoFactor.lockedUntil": null }, { "twoFactor.lockedUntil": { $lte: now } }],
      },
      { $inc: { "twoFactor.failedAttempts": 1 } },
      { new: true }
    ).lean(),
  lockSecondFactor: (id, until) =>
    User.updateOne(
      { _id: ownerId(id), "twoFactor.enabled": true },
      { $set: { "twoFactor.lockedUntil": until, "twoFactor.failedAttempts": 0 } }
    ),
  lockStalledSecondFactor: (id, now, until, maxFailed) =>
    User.updateOne(
      {
        _id: ownerId(id),
        "twoFactor.enabled": true,
        "twoFactor.failedAttempts": { $gte: maxFailed },
        $or: [{ "twoFactor.lockedUntil": null }, { "twoFactor.lockedUntil": { $lte: now } }],
      },
      { $set: { "twoFactor.lockedUntil": until, "twoFactor.failedAttempts": 0 } }
    ),
  acceptTotpStep: (id, step) =>
    User.updateOne(
      { _id: ownerId(id), "twoFactor.enabled": true, "twoFactor.lastUsedStep": { $not: { $gte: step } } },
      { $set: { "twoFactor.lastUsedStep": step, "twoFactor.failedAttempts": 0, "twoFactor.lockedUntil": null } }
    ),
  acceptBackupCode: (id, hash) =>
    User.findOneAndUpdate(
      { _id: ownerId(id), "twoFactor.enabled": true, "twoFactor.backupCodeHashes": hash },
      {
        $pull: { "twoFactor.backupCodeHashes": hash },
        $set: { "twoFactor.failedAttempts": 0, "twoFactor.lockedUntil": null },
      },
      { new: true, projection: { "twoFactor.backupCodeHashes": 1 } }
    ).lean(),
  reserveCodeAttempt: (id, kind, codeHash, maxAttempts) => {
    if (!CODE_KINDS.has(kind)) throw new Error(`Unknown code kind: ${kind}`);
    return User.findOneAndUpdate(
      { _id: ownerId(id), [`${kind}.codeHash`]: codeHash, [`${kind}.attempts`]: { $not: { $gte: maxAttempts } } },
      { $inc: { [`${kind}.attempts`]: 1 } },
      { new: true, projection: { [`${kind}.attempts`]: 1 } }
    ).lean();
  },
  enableTwoFactor: (id, pendingSecretEnc, state) =>
    User.updateOne(
      { _id: ownerId(id), "twoFactor.enabled": { $ne: true }, "twoFactor.pendingSecretEnc": pendingSecretEnc },
      { $set: { twoFactor: state } }
    ),
};
