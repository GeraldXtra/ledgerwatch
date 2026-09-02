const mongoose = require("mongoose");

// A coin the user is monitoring, with a trigger condition.
const conditionSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["drop_pct", "rise_pct", "price_below", "price_above"],
      required: true,
    },
    value: { type: Number, required: true },
  },
  { _id: false }
);

const watchSchema = new mongoose.Schema({
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
  coinId: { type: String, required: true }, // e.g. "bitcoin"
  symbol: { type: String, required: true }, // e.g. "BTC"
  condition: { type: conditionSchema, required: true },
  baselinePrice: { type: Number, default: null }, // price (USD) captured at creation, for drop/rise %
  active: { type: Boolean, default: true },
  lastTriggeredAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Watch", watchSchema);