const mongoose = require("mongoose");

const walletTxSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  chainId: { type: Number, required: true },
  hash: { type: String, required: true },
  from: { type: String, required: true },
  to: { type: String, required: true },
  value: { type: String, default: "0" },
  symbol: { type: String, default: "ETH" },
  tokenAddress: { type: String, default: null },
  direction: { type: String, enum: ["out", "in"], default: "out" },
  status: { type: String, enum: ["pending", "confirmed", "failed"], default: "pending" },

  kind: { type: String, enum: ["transfer", "swap", "approval"], default: "transfer" },

  blockNumber: { type: Number, default: null },

  tokenOut: { type: String, default: null },
  tokenOutSymbol: { type: String, default: null },
  amountOut: { type: String, default: null },
  minAmountOut: { type: String, default: null },
  feeTier: { type: Number, default: null },
  route: { type: String, default: null },
  priceImpactPct: { type: Number, default: null },
  side: { type: String, enum: ["buy", "sell"], default: null },
  alertId: { type: mongoose.Schema.Types.ObjectId, ref: "Alert", default: null },

  amountOutActual: { type: String, default: null },
  profitId: { type: mongoose.Schema.Types.ObjectId, ref: "ProfitRecord", default: null },

  notifiedAt: { type: Date, default: null },
  lastCheckedAt: { type: Date, default: null },

  createdAt: { type: Date, default: Date.now },
});

walletTxSchema.index({ userId: 1, chainId: 1, createdAt: -1 });

walletTxSchema.index({ status: 1, lastCheckedAt: 1 });

walletTxSchema.index({ hash: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model("WalletTx", walletTxSchema);
