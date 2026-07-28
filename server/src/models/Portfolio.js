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
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    unique: true,
  },
  cashBalance: { type: Number, default: 1000000 },
  holdings: { type: [holdingSchema], default: [] },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Portfolio", portfolioSchema);