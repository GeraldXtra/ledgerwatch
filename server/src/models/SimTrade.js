const mongoose = require("mongoose");

const simTradeSchema = new mongoose.Schema({
  mode: { type: String, enum: ["paper", "live"], default: "paper", index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  coinId: { type: String, required: true },
  symbol: { type: String, required: true },
  side: { type: String, enum: ["buy", "sell"], required: true },
  qty: { type: Number, required: true },
  priceAtTrade: { type: Number, required: true },
  approvedByUser: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

simTradeSchema.index({ userId: 1, mode: 1, createdAt: -1 });

module.exports = mongoose.model("SimTrade", simTradeSchema);