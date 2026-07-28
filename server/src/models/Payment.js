const mongoose = require("mongoose");

// A payment recorded against a debt. Businesses receive part-payments, so a debt
// can have many of these; balance = debt.amount - sum(payments).
const paymentSchema = new mongoose.Schema({
  debtId: { type: mongoose.Schema.Types.ObjectId, ref: "Debt", required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  amount: { type: Number, required: true },
  paidAt: { type: Date, default: Date.now },
  method: { type: String, enum: ["cash", "transfer", "other"], default: "transfer" },
  note: { type: String },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Payment", paymentSchema);
