const bcrypt = require("bcryptjs");
const User = require("../models/User");
const Portfolio = require("../models/Portfolio");
const signToken = require("../utils/token");
const publicUser = require("../utils/publicUser");
const { buildCryptoUpdate } = require("../services/cryptoSettings.service");

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
    const { name, email, password, bankDetails } = req.body || {};

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
    });

    // Auto-create the user's sim Portfolio (cashBalance default 1,000,000).
    await Portfolio.create({ userId: user._id });

    const token = signToken(user._id);
    return res.status(201).json({ token, user: publicUser(user) });
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
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ error: "email and password are required" });
    }

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
    const { name, companyName, bankDetails, autoSend, notifyPrefs, crypto, chainSwitchMode } =
      req.body || {};
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
    // Whitelisted explicitly rather than passed through: an unknown value would
    // fail schema validation and reject the whole profile save.
    if (chainSwitchMode === "prompt" || chainSwitchMode === "auto") {
      updates.chainSwitchMode = chainSwitchMode;
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
          "Nothing to update (provide name, companyName, bankDetails, autoSend, notifyPrefs, crypto and/or chainSwitchMode)",
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

module.exports = { register, login, me, updateMe };
