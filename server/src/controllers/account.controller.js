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
const PushSubscription = require("../models/PushSubscription");
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

async function changePassword(req, res) {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Current and new password are required" });
    }
    const user = await User.findById(req.user._id);
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
  await Promise.all([
    Debt.deleteMany({ userId }),
    Payment.deleteMany({ userId }),
    Reminder.deleteMany({ userId }),
    Watch.deleteMany({ userId }),
    Alert.deleteMany({ userId }),
    SimTrade.deleteMany({ userId }),
    Portfolio.deleteMany({ userId }),
    PaymentAddress.deleteMany({ userId }),
    WalletTx.deleteMany({ userId }),
    PushSubscription.deleteMany({ userId }),
    User.updateOne(
      { _id: userId },
      { $set: { walletHistoryCursors: [], discoveredTokens: [] } }
    ),
  ]);
}

async function clearData(req, res) {
  try {
    await wipeUserData(req.user._id);
    await Portfolio.create({ userId: req.user._id });
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
    await User.findByIdAndDelete(req.user._id);
    return res.json({ ok: true });
  } catch (err) {
    console.error("deleteAccount error:", err.message);
    return res.status(500).json({ error: "Failed to delete account" });
  }
}

module.exports = { setAvatar, removeAvatar, changePassword, clearData, deleteAccount };
