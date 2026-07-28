const mongoose = require("mongoose");

// history entries: e.g. { event: "created" | "reminded" | "marked_paid" }
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
  debtorEmail: { type: String }, // optional; enables email reminders
  amount: { type: Number, required: true },
  currency: { type: String, default: "NGN" },
  dueDate: { type: Date, required: true },
  note: { type: String },
  status: {
    type: String,
    enum: ["pending", "partially_paid", "paid"],
    default: "pending",
  },
  reminderCadenceDays: { type: Number, default: 3 }, // how often to re-remind after due
  lastRemindedAt: { type: Date, default: null },
  history: { type: [historyEntrySchema], default: [] },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Debt", debtSchema);