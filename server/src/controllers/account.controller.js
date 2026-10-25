const bcrypt = require("bcryptjs");
const { scopedRepo, TENANT_MODELS } = require("../repositories/scoped");
const accounts = require("../repositories/accounts");
const publicUser = require("../utils/publicUser");
const signToken = require("../utils/token");

const SALT_ROUNDS = 12;
const { passwordProblem } = require("../middleware/security");

const DATA_URL_RE = /^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/;
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

const PROTECTED_EMAIL = "demo@ledgerwatch.app";

function decodedByteLength(b64) {
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

async function setAvatar(req, res) {
  try {
    const dataUrl = req.body.dataUrl || "";
    const match = DATA_URL_RE.exec(dataUrl);
    if (!match) {
      return res
        .status(400)
        .json({ error: "Image must be a base64 data URL of type jpeg, png or webp" });
    }
    if (decodedByteLength(match[2]) > MAX_AVATAR_BYTES) {
      return res.status(413).json({ error: "Image must be 2MB or smaller" });
    }

    const user = await scopedRepo(req.user._id).self.update({ $set: { avatarUrl: dataUrl } }).select("-passwordHash");

    return res.json({ user: publicUser(user) });
  } catch (err) {
    console.error("setAvatar error:", err.message);
    return res.status(500).json({ error: "Failed to save picture" });
  }
}

async function removeAvatar(req, res) {
  try {
    const user = await scopedRepo(req.user._id).self.update({ $set: { avatarUrl: null } }).select("-passwordHash");
    return res.json({ user: publicUser(user) });
  } catch (err) {
    console.error("removeAvatar error:", err.message);
    return res.status(500).json({ error: "Failed to remove picture" });
  }
}

async function changePassword(req, res) {
  try {
    if (String(req.user.email).toLowerCase() === PROTECTED_EMAIL) {
      return res.status(403).json({ error: "The shared demo account's password cannot be changed." });
    }
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Current and new password are required" });
    }
    const user = await accounts.findById(req.user._id);
    if (!user) return res.status(401).json({ error: "User no longer exists" });

    const weak = passwordProblem(newPassword, { email: user.email, name: user.name });
    if (weak) return res.status(400).json({ error: weak.replace(/^Password/, "New password") });

    const match = await bcrypt.compare(String(currentPassword), user.passwordHash);
    if (!match) return res.status(400).json({ error: "Current password is incorrect" });

    user.passwordHash = await bcrypt.hash(String(newPassword), SALT_ROUNDS);
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save();

    return res.json({ ok: true, token: signToken(user._id, user.tokenVersion) });
  } catch (err) {
    console.error("changePassword error:", err.message);
    return res.status(500).json({ error: "Failed to change password" });
  }
}

async function wipeUserData(userId) {
  const repo = scopedRepo(userId);
  await Promise.all([
    ...Object.keys(TENANT_MODELS).map((name) => repo[name].deleteMany({})),
    repo.self.updateOne({ $set: { walletHistoryCursors: [], discoveredTokens: [] } }),
  ]);
}

async function clearData(req, res) {
  try {
    await wipeUserData(req.user._id);
    await scopedRepo(req.user._id).portfolios.create({});
    return res.json({ ok: true });
  } catch (err) {
    console.error("clearData error:", err.message);
    return res.status(500).json({ error: "Failed to clear data" });
  }
}

async function deleteAccount(req, res) {
  try {
    if (String(req.user.email).toLowerCase() === PROTECTED_EMAIL) {
      return res.status(403).json({ error: "The shared demo account cannot be deleted." });
    }
    await wipeUserData(req.user._id);
    await accounts.deleteById(req.user._id);
    return res.json({ ok: true });
  } catch (err) {
    console.error("deleteAccount error:", err.message);
    return res.status(500).json({ error: "Failed to delete account" });
  }
}

module.exports = { setAvatar, removeAvatar, changePassword, clearData, deleteAccount, wipeUserData };
