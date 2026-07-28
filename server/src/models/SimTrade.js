const mongoose = require("mongoose");

// Paper-trading portfolio entries (no real funds).
const simTradeSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  coinId: { type: String, required: true },
  symbol: { type: String, required: true },
  side: { type: String, enum: ["buy", "sell"], required: true },
  qty: { type: Number, required: true },
  priceAtTrade: { type: Number, required: true },
  approvedByUser: { type: Boolean, default: false }, // must be true before it counts
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("SimTrade", simTradeSchema);