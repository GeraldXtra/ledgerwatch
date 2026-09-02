const mongoose = require("mongoose");

// Paper-trading portfolio entries (no real funds).
const simTradeSchema = new mongoose.Schema({
  /**
   * Which side of the app this row belongs to.
   *
   * Paper and live were sharing one set of watches, alerts, trades and holdings,
   * so a simulated position and a real one appeared in the same list and a paper
   * alert could be acted on with real money. They are different books and must
   * never be summed together.
   *
   * Defaults to "paper" so every row that existed before this field is treated as
   * simulated, which is what it was.
   */
  mode: { type: String, enum: ["paper", "live"], default: "paper", index: true },
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