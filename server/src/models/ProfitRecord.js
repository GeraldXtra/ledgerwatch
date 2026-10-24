const mongoose = require("mongoose");

const profitRecordSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  mode: { type: String, enum: ["paper", "live"], required: true },
  status: {
    type: String,
    enum: ["moved", "pending", "moving", "dismissed", "loss", "no-basis"],
    required: true,
  },

  coinId: { type: String, default: null },
  symbol: { type: String, required: true },
  chainId: { type: Number, default: null },
  assetAddress: { type: String, default: null },

  qty: { type: Number, required: true },
  coveredQty: { type: Number, default: null },
  avgCost: { type: Number, default: null },
  price: { type: Number, default: null },
  costUsd: { type: Number, default: null },
  proceedsUsd: { type: Number, default: null },
  profitUsd: { type: Number, default: 0 },
  profitPct: { type: Number, default: null },
  basisEstimated: { type: Boolean, default: false },
  note: { type: String, default: null },

  cashSymbol: { type: String, default: "USD" },
  cashAddress: { type: String, default: null },
  cashDecimals: { type: Number, default: null },
  profitAmount: { type: String, default: null },

  tradeId: { type: mongoose.Schema.Types.ObjectId, ref: "SimTrade", default: null },
  txId: { type: mongoose.Schema.Types.ObjectId, ref: "WalletTx", default: null },
  txHash: { type: String, default: null },

  message: { type: String, default: null },

  moveTxId: { type: mongoose.Schema.Types.ObjectId, ref: "WalletTx", default: null },
  moveTxHash: { type: String, default: null },
  profitAddress: { type: String, default: null },
  movedAt: { type: Date, default: null },
  decidedAt: { type: Date, default: null },

  createdAt: { type: Date, default: Date.now },
});

profitRecordSchema.index({ userId: 1, mode: 1, createdAt: -1 });
profitRecordSchema.index({ txId: 1 }, { unique: true, partialFilterExpression: { txId: { $type: "objectId" } } });
profitRecordSchema.index({ tradeId: 1 }, { unique: true, partialFilterExpression: { tradeId: { $type: "objectId" } } });
profitRecordSchema.index({ moveTxId: 1 }, { sparse: true });

module.exports = mongoose.model("ProfitRecord", profitRecordSchema);
