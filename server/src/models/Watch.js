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