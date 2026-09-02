const mongoose = require("mongoose");

// Things the agent surfaced for user approval.
const alertSchema = new mongoose.Schema({
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
  watchId: { type: mongoose.Schema.Types.ObjectId, ref: "Watch", required: true },
  coinId: { type: String, required: true },
  symbol: { type: String, required: true },
  message: { type: String }, // AI explanation
  // What the AGENT recommended. Advisory only — the user may act against it.
  suggestion: { type: String, enum: ["buy", "sell", "hold"], required: true },
  priceAtAlert: { type: Number }, // price when the alert fired
  status: {
    type: String,
    enum: ["pending", "approved", "dismissed"],
    default: "pending",
  },

  // What the USER actually did. Recorded separately from `suggestion` so alert
  // history can show recommendation vs decision — including when the user went
  // against the agent, which is the point of keeping a human in the loop.
  userAction: {
    type: String,
    enum: ["buy", "sell", "dismiss", null],
    default: null,
  },
  executedQty: { type: Number, default: null }, // token amount actually traded
  executedValue: { type: Number, default: null }, // quote-currency value traded
  executedPrice: { type: Number, default: null },
  actedAt: { type: Date, default: null },

  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Alert", alertSchema);