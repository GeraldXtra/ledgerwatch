const mongoose = require("mongoose");

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
  mode: { type: String, enum: ["paper", "live"], default: "paper", index: true },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  cashBalance: { type: Number, default: 1000000 },
  profitBalance: { type: Number, default: 0 },
  holdings: { type: [holdingSchema], default: [] },
  createdAt: { type: Date, default: Date.now },
});

portfolioSchema.index({ userId: 1, mode: 1 }, { unique: true });

module.exports = mongoose.model("Portfolio", portfolioSchema);