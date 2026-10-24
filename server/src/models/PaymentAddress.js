const mongoose = require("mongoose");

const observedTxSchema = new mongoose.Schema(
  {
    txHash: { type: String, required: true },
    from: { type: String },
    value: { type: String, required: true },
    blockNumber: { type: Number },
    blockHash: { type: String },
    confirmations: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["detected", "confirmed", "orphaned"],
      default: "detected",
    },
    settledPaymentId: { type: mongoose.Schema.Types.ObjectId, ref: "Payment", default: null },
    late: { type: Boolean, default: false },
    seenAt: { type: Date, default: Date.now },
    confirmedAt: { type: Date, default: null },
  },
  { _id: false }
);

const sweepSchema = new mongoose.Schema(
  {
    txHash: { type: String, required: true },
    destination: { type: String, required: true },
    amountUsdc: { type: Number, required: true },
    gasFundedTxHash: { type: String, default: null },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const foreignTxSchema = new mongoose.Schema(
  {
    txHash: { type: String, required: true },
    contract: { type: String },
    value: { type: String },
    seenAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const paymentAddressSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  debtId: { type: mongoose.Schema.Types.ObjectId, ref: "Debt", required: true, index: true },

  chainId: { type: Number, required: true },
  derivationIndex: { type: Number, required: true },
  address: { type: String, required: true },

  tokenSymbol: { type: String, required: true },
  tokenContract: { type: String, required: true },
  tokenDecimals: { type: Number, required: true },

  quote: {
    invoiceBalanceNgn: { type: Number },
    expectedUsdc: { type: Number },
    ngnPerUsd: { type: Number },
    rateTimestamp: { type: Date },
    rateIsFallback: { type: Boolean, default: false },
    issuedAt: { type: Date },
    reconstructed: { type: Boolean, default: false },
  },

  invoiceBalanceNgn: { type: Number, required: true },
  expectedUsdc: { type: Number, required: true },
  ngnPerUsd: { type: Number, required: true },
  rateTimestamp: { type: Date, required: true },
  rateIsFallback: { type: Boolean, default: false },

  receivedUsdc: { type: Number, default: 0 },
  settledNgn: { type: Number, default: 0 },
  overpaidUsdc: { type: Number, default: 0 },

  unattributedUsdc: { type: Number, default: 0 },
  unattributedAt: { type: Date, default: null },

  status: {
    type: String,
    enum: ["active", "expired", "paid", "swept", "revoked"],
    default: "active",
    index: true,
  },

  observed: { type: [observedTxSchema], default: [] },
  foreign: { type: [foreignTxSchema], default: [] },
  sweeps: { type: [sweepSchema], default: [] },

  lastScannedBlock: { type: Number, default: 0 },

  expiresAt: { type: Date, required: true },
  expiredAt: { type: Date, default: null },
  lastWatchedAt: { type: Date, default: null },
  unidentifiedBalanceAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
});

paymentAddressSchema.index({ userId: 1, derivationIndex: 1 }, { unique: true });

paymentAddressSchema.index({ address: 1 }, { unique: true });

paymentAddressSchema.index({ status: 1, chainId: 1 });

paymentAddressSchema.index({ status: 1, lastWatchedAt: 1 });

paymentAddressSchema.index(
  { debtId: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: "active" } }
);

module.exports = mongoose.model("PaymentAddress", paymentAddressSchema);
