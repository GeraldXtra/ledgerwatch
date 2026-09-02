const mongoose = require("mongoose");

// One sim wallet per user. Start with ₦1,000,000 fake cash.
const holdingSchema = new mongoose.Schema(
  {
    coinId: { type: String, required: true },
    symbol: { type: String, required: true },
    qty: { type: Number, required: true },
    avgBuyPrice: { type: Number, required: true },
  },
  { _id: false }
);

const portfolioSchema = new mongoose.Schema({
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
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  cashBalance: { type: Number, default: 1000000 },
  holdings: { type: [holdingSchema], default: [] },
  createdAt: { type: Date, default: Date.now },
});

/**
 * One book per user PER MODE, not one per user.
 *
 * `userId` used to carry `unique: true` on its own, which made a second book
 * impossible and is why paper and live shared one. The uniqueness still has to
 * exist — two paper books for the same person would silently split their cash —
 * so it moves onto the pair.
 */
portfolioSchema.index({ userId: 1, mode: 1 }, { unique: true });

module.exports = mongoose.model("Portfolio", portfolioSchema);