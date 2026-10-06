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

  /**
   * The on-chain transaction that settled a LIVE alert.
   *
   * A paper alert is closed by `actOnAlert`, which writes a SimTrade. A live one
   * is not: the browser signs a real swap and the alert had nothing to record it
   * against, so it stayed `pending` — and the price pass refuses to raise a
   * second alert on a watch that already has one waiting. Every live watch
   * therefore alerted exactly once, ever, and then went quiet.
   *
   * `POST /api/alerts/:id/executed` writes these after the swap is broadcast.
   */
  txHash: { type: String, default: null },
  chainId: { type: Number, default: null },

  createdAt: { type: Date, default: Date.now },
});

/**
 * The dedup guard — "is an alert already pending on this watch?" — runs once per
 * watch per pass, so it is the market side's equivalent of the payments sum.
 * The list and history screens read by account, mode and recency.
 */
alertSchema.index({ watchId: 1, mode: 1, status: 1 });
alertSchema.index({ userId: 1, mode: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model("Alert", alertSchema);