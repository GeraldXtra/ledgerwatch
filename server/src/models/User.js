const mongoose = require("mongoose");

// bankDetails is embedded on the user and used inside reminder messages.
const bankDetailsSchema = new mongoose.Schema(
  {
    accountName: { type: String },
    accountNumber: { type: String },
    bankName: { type: String },
  },
  { _id: false }
);

// Automatic reminder delivery — opt-in, default OFF. When enabled, the automation
// engine dispatches reminders through the configured channels instead of only
// generating them.
const autoSendSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: false },
    whatsapp: { type: Boolean, default: false },
    email: { type: Boolean, default: false },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  bankDetails: { type: bankDetailsSchema, default: {} },
  autoSend: { type: autoSendSchema, default: () => ({}) },
  // Public wallet address only — private keys never touch the server (Phase 4).
  walletAddress: { type: String, default: null },
  // Profile picture as a base64 data URL. Stored on the document so it needs no
  // external object storage and survives redeploys; the client square-crops and
  // resizes to ~512px first, and the server caps the DECODED size at 2MB.
  avatarUrl: { type: String, default: null },
  // Shown on reminders and statements alongside the payout details.
  companyName: { type: String, default: "" },
  // Per-category push opt-outs. Absent/true = send; explicit false = suppress.
  notifyPrefs: {
    marketAlerts: { type: Boolean, default: true },
    remindersDue: { type: Boolean, default: true },
    txUpdates: { type: Boolean, default: true },
  },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("User", userSchema);