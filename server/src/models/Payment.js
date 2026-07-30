const mongoose = require("mongoose");

// A payment recorded against a debt. Businesses receive part-payments, so a debt
// can have many of these; balance = debt.amount - sum(payments).
const paymentSchema = new mongoose.Schema({
  debtId: { type: mongoose.Schema.Types.ObjectId, ref: "Debt", required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  amount: { type: Number, required: true },
  paidAt: { type: Date, default: Date.now },
  // "crypto" marks a payment settled automatically from a confirmed on-chain
  // stablecoin transfer, so the source of every figure stays truthful.
  method: {
    type: String,
    enum: ["cash", "transfer", "crypto", "other"],
    default: "transfer",
  },
  note: { type: String },

  /**
   * IDEMPOTENCY KEY for crypto settlements.
   *
   * A transaction hash must settle EXACTLY once — the watch pass runs on a timer
   * AND from the manual trigger, and may be interrupted mid-pass by a restart.
   * This unique index makes a second attempt fail at the database rather than
   * relying on application logic to remember: `Payment.create()` with a hash that
   * already settled raises E11000, which the watcher treats as "already done".
   *
   * `sparse` so the index only covers crypto payments — manual payments have no
   * hash, and without sparse they would all collide on null.
   */
  txHash: { type: String, default: undefined },

  createdAt: { type: Date, default: Date.now },
});

paymentSchema.index({ txHash: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model("Payment", paymentSchema);
