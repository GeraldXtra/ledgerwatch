const mongoose = require("mongoose");

// Per-channel delivery record for a reminder (WhatsApp / Email).
const deliverySchema = new mongoose.Schema(
  {
    channel: { type: String, enum: ["whatsapp", "email"], required: true },
    status: { type: String, enum: ["queued", "sent", "failed", "skipped"], default: "queued" },
    providerId: { type: String },
    error: { type: String },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

// Log of generated reminders — powers "cancel on paid" + delivery tracking.
const reminderSchema = new mongoose.Schema({
  debtId: { type: mongoose.Schema.Types.ObjectId, ref: "Debt", required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  messageText: { type: String }, // includes owner bank details + crypto block (plain text)
  // The same message WITHOUT the plain-text crypto block. Email renders the crypto
  // details as rich HTML with a QR instead, so it needs the text body on its own —
  // otherwise the address and warning would appear twice in the same email.
  baseMessageText: { type: String },
  scheduledFor: { type: Date },
  status: {
    type: String,
    enum: ["scheduled", "sent", "cancelled"],
    default: "scheduled",
  },
  deliveries: { type: [deliverySchema], default: [] },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Reminder", reminderSchema);