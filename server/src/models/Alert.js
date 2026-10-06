const mongoose = require("mongoose");

const alertSchema = new mongoose.Schema({
  mode: { type: String, enum: ["paper", "live"], default: "paper", index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  watchId: { type: mongoose.Schema.Types.ObjectId, ref: "Watch", required: true },
  coinId: { type: String, required: true },
  symbol: { type: String, required: true },
  message: { type: String },
  suggestion: { type: String, enum: ["buy", "sell", "hold"], required: true },
  priceAtAlert: { type: Number },
  status: {
    type: String,
    enum: ["pending", "approved", "dismissed"],
    default: "pending",
  },

  userAction: {
    type: String,
    enum: ["buy", "sell", "dismiss", null],
    default: null,
  },
  executedQty: { type: Number, default: null },
  executedValue: { type: Number, default: null },
  executedPrice: { type: Number, default: null },
  actedAt: { type: Date, default: null },

  txHash: { type: String, default: null },
  chainId: { type: Number, default: null },

  createdAt: { type: Date, default: Date.now },
});

alertSchema.index({ watchId: 1, mode: 1, status: 1 });
alertSchema.index({ userId: 1, mode: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model("Alert", alertSchema);