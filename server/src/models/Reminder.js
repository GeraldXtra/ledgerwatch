const mongoose = require("mongoose");

const deliverySchema = new mongoose.Schema(
  {
    channel: { type: String, enum: ["whatsapp", "email"], required: true },
    status: { type: String, enum: ["queued", "sent", "failed", "skipped"], default: "queued" },
    providerId: { type: String },
    reason: { type: String },
    error: { type: String },
    warning: { type: String },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const reminderSchema = new mongoose.Schema({
  debtId: { type: mongoose.Schema.Types.ObjectId, ref: "Debt", required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  messageText: { type: String },
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

reminderSchema.index({ debtId: 1, createdAt: -1 });
reminderSchema.index({ userId: 1, status: 1 });

module.exports = mongoose.model("Reminder", reminderSchema);