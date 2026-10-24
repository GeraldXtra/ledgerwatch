const mongoose = require("mongoose");

const rampOrderSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  provider: { type: String, enum: ["transak"], default: "transak" },
  partnerOrderId: { type: String, default: null },
  providerOrderId: { type: String, default: null },
  mode: { type: String, enum: ["BUY", "SELL"], required: true },
  status: { type: String, default: "SESSION_CREATED" },
  outcome: { type: String, enum: ["started", "in-progress", "on-hold", "completed", "failed"], default: "started" },
  cryptoCurrency: { type: String, default: null },
  cryptoAmount: { type: String, default: null },
  fiatCurrency: { type: String, default: "NGN" },
  fiatAmount: { type: String, default: null },
  network: { type: String, default: null },
  walletAddress: { type: String, default: null },
  txHash: { type: String, default: null },
  lastEvent: { type: String, default: null },
  matchedBy: { type: String, default: null },
  notifiedOutcome: { type: String, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

rampOrderSchema.index({ partnerOrderId: 1 }, { unique: true, partialFilterExpression: { partnerOrderId: { $type: "string" } } });
rampOrderSchema.index({ providerOrderId: 1 }, { unique: true, partialFilterExpression: { providerOrderId: { $type: "string" } } });
rampOrderSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model("RampOrder", rampOrderSchema);
