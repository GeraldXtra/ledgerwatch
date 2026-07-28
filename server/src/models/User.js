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
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("User", userSchema);