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

/**
 * INDEXES. There were none, on the collection every screen and the automation
 * loop read most.
 *
 * `doReminderPass` runs `Debt.find({ status: {$in: [...]}, dueDate: {$lte: now} })`
 * on a timer, with NO userId filter and no limit — a full collection scan of
 * every invoice belonging to every account, once a minute, plus a second scan
 * for `countDocuments` on the not-yet-due count. Every list, statement and
 * analytics read filters on `userId`.
 *
 * Ordering matters: the equality field goes first, the range field second, so
 * the index can seek rather than scan.
 */
debtSchema.index({ userId: 1, status: 1, dueDate: 1 });
debtSchema.index({ status: 1, dueDate: 1 });
debtSchema.index({ userId: 1, createdAt: -1 });
// Debtors are grouped by name in memory today; this makes the per-debtor
// profile and statement reads a seek instead of a scan of the account.
debtSchema.index({ userId: 1, debtorName: 1 });

module.exports = mongoose.model("Debt", debtSchema);