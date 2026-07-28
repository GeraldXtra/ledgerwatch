const mongoose = require("mongoose");

// Things the agent surfaced for user approval.
const alertSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  watchId: { type: mongoose.Schema.Types.ObjectId, ref: "Watch", required: true },
  coinId: { type: String, required: true },
  symbol: { type: String, required: true },
  message: { type: String }, // AI explanation
  suggestion: { type: String, enum: ["buy", "sell", "hold"], required: true },
  priceAtAlert: { type: Number }, // price when the alert fired
  status: {
    type: String,
    enum: ["pending", "approved", "dismissed"],
    default: "pending",
  },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Alert", alertSchema);