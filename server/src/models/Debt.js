const mongoose = require("mongoose");

const historyEntrySchema = new mongoose.Schema(
  {
    at: { type: Date, default: Date.now },
    event: { type: String },
  },
  { _id: false }
);

const debtSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  debtorName: { type: String, required: true },
  debtorPhone: { type: String },
  debtorEmail: { type: String },
  amount: { type: Number, required: true },
  currency: { type: String, default: "NGN" },
  dueDate: { type: Date, required: true },
  note: { type: String },
  status: {
    type: String,
    enum: ["pending", "partially_paid", "paid"],
    default: "pending",
  },
  reminderCadenceDays: { type: Number, default: 3 },
  lastRemindedAt: { type: Date, default: null },
  history: { type: [historyEntrySchema], default: [] },
  createdAt: { type: Date, default: Date.now },
});

debtSchema.index({ userId: 1, status: 1, dueDate: 1 });
debtSchema.index({ status: 1, dueDate: 1 });
debtSchema.index({ userId: 1, createdAt: -1 });
debtSchema.index({ userId: 1, debtorName: 1 });

module.exports = mongoose.model("Debt", debtSchema);