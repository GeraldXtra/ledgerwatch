const mongoose = require("mongoose");

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
  mode: { type: String, enum: ["paper", "live"], default: "paper", index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  coinId: { type: String, required: true },
  symbol: { type: String, required: true },
  condition: { type: conditionSchema, required: true },
  baselinePrice: { type: Number, default: null },
  active: { type: Boolean, default: true },
  lastTriggeredAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
});

watchSchema.index({ active: 1 });
watchSchema.index({ userId: 1, mode: 1, active: 1 });

module.exports = mongoose.model("Watch", watchSchema);