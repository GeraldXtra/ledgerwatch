const bcrypt = require("bcryptjs");
const User = require("../models/User");
const Debt = require("../models/Debt");
const Payment = require("../models/Payment");
const Reminder = require("../models/Reminder");
const Watch = require("../models/Watch");
const Alert = require("../models/Alert");
const SimTrade = require("../models/SimTrade");
const Portfolio = require("../models/Portfolio");
const PaymentAddress = require("../models/PaymentAddress");
const WalletTx = require("../models/WalletTx");
const publicUser = require("../utils/publicUser");

const SALT_ROUNDS = 10;

// Avatars arrive as base64 data URLs. Only real raster image types are accepted,
// and the cap is measured on the DECODED bytes so base64's ~33% overhead cannot
// smuggle a larger file past the limit.
const DATA_URL_RE = /^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/;
const MAX_AVATAR_BYTES = 2 * 1024 * 1024; // 2MB

// The shared demo account must keep working for testing.
const PROTECTED_EMAIL = "demo@ledgerwatch.app";

function decodedByteLength(b64) {
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

// POST /api/auth/me/avatar   { dataUrl }
async function setAvatar(req, res) {
  try {
    const dataUrl = (req.body && req.body.dataUrl) || "";
    const match = DATA_URL_RE.exec(dataUrl);
    if (!match) {
      return res
        .status(400)
        .json({ error: "Image must be a base64 data URL of type jpeg, png or webp" });
    }
    if (decodedByteLength(match[2]) > MAX_AVATAR_BYTES) {
      return res.status(413).json({ error: "Image must be 2MB or smaller" });
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { avatarUrl: dataUrl },
      { new: true }
    ).select("-passwordHash");

    return res.json({ user: publicUser(user) });
  } catch (err) {
    console.error("setAvatar error:", err.message);
    return res.status(500).json({ error: "Failed to save picture" });
  }
}

// DELETE /api/auth/me/avatar
async function removeAvatar(req, res) {
  try {
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { avatarUrl: null },
      { new: true }
    ).select("-passwordHash");
    return res.json({ user: publicUser(user) });
  } catch (err) {
    console.error("removeAvatar error:", err.message);
    return res.status(500).json({ error: "Failed to remove picture" });
  }
}

// POST /api/auth/me/password   { currentPassword, newPassword }
async function changePassword(req, res) {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Current and new password are required" });
    }
    if (String(newPassword).length < 8) {
      return res.status(400).json({ error: "New password must be at least 8 characters" });
    }

    // req.user is loaded without passwordHash by the auth middleware, so re-fetch.
    const user = await User.findById(req.user._id);
    if (!user) return res.status(401).json({ error: "User no longer exists" });

    const match = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!match) return res.status(400).json({ error: "Current password is incorrect" });

    user.passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await user.save();

    return res.json({ ok: true });
  } catch (err) {
    console.error("changePassword error:", err.message);
    return res.status(500).json({ error: "Failed to change password" });
  }
}

// Every collection owned by a user, scoped by userId. Shared by clear-data and
// delete-account so the two can never drift apart.
async function wipeUserData(userId) {
  await Promise.all([
    Debt.deleteMany({ userId }),
    Payment.deleteMany({ userId }),
    Reminder.deleteMany({ userId }),
    Watch.deleteMany({ userId }),
    Alert.deleteMany({ userId }),
    SimTrade.deleteMany({ userId }),
    Portfolio.deleteMany({ userId }),
    // Payment addresses were missing here, so clearing data or deleting an
    // account left rows the watch pass kept scanning forever on behalf of a user
    // that no longer existed.
    PaymentAddress.deleteMany({ userId }),
    WalletTx.deleteMany({ userId }),
  ]);
}

// POST /api/auth/me/clear-data
async function clearData(req, res) {
  try {
    await wipeUserData(req.user._id);
    // Recreate an empty simulated portfolio so Market Watch still has one.
    await Portfolio.create({ userId: req.user._id });
    return res.json({ ok: true });
  } catch (err) {
    console.error("clearData error:", err.message);
    return res.status(500).json({ error: "Failed to clear data" });
  }
}

// DELETE /api/auth/me
async function deleteAccount(req, res) {
  try {
    if (String(req.user.email).toLowerCase() === PROTECTED_EMAIL) {
      return res.status(403).json({ error: "The shared demo account cannot be deleted." });
    }
    await wipeUserData(req.user._id);
    await User.findByIdAndDelete(req.user._id);
    return res.json({ ok: true });
  } catch (err) {
    console.error("deleteAccount error:", err.message);
    return res.status(500).json({ error: "Failed to delete account" });
  }
}

module.exports = { setAvatar, removeAvatar, changePassword, clearData, deleteAccount };
