const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema({
  debtId: { type: mongoose.Schema.Types.ObjectId, ref: "Debt", required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  amount: { type: Number, required: true },
  amountKobo: { type: Number },
  paidAt: { type: Date, default: Date.now },
  method: {
    type: String,
    enum: ["cash", "transfer", "crypto", "other"],
    default: "transfer",
  },
  note: { type: String },

  txHash: { type: String, default: undefined },

  txHashes: { type: [String], default: undefined },

  createdAt: { type: Date, default: Date.now },
});

paymentSchema.index({ txHash: 1 }, { unique: true, sparse: true });
paymentSchema.index({ txHashes: 1 }, { sparse: true });

paymentSchema.index({ debtId: 1 });
paymentSchema.index({ userId: 1, paidAt: -1 });

module.exports = mongoose.model("Payment", paymentSchema);
