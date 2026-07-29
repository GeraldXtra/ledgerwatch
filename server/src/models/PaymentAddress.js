const mongoose = require("mongoose");

/**
 * A stablecoin payment address issued for ONE invoice.
 *
 * KEY SAFETY: this document holds the derivation INDEX and the PUBLIC address
 * only. No private key, no extended key, no mnemonic — ever. The key for this
 * address is derived in the browser on demand from the user's encrypted master
 * keystore after they enter their password, and discarded immediately after use.
 * The server therefore cannot move these funds even if fully compromised.
 */

// One inbound transfer seen at this address.
const observedTxSchema = new mongoose.Schema(
  {
    txHash: { type: String, required: true },
    from: { type: String },
    // Raw token units as a STRING — token amounts exceed IEEE-754 integer safety
    // (USDC has 6 decimals, but this keeps the model correct for 18-decimal
    // tokens too, where a balance easily exceeds 2^53).
    value: { type: String, required: true },
    blockNumber: { type: Number },
    blockHash: { type: String },
    confirmations: { type: Number, default: 0 },
    // detected  -> seen on chain, not yet deep enough to trust
    // confirmed -> reached the required depth, settled against the invoice
    // orphaned  -> vanished in a reorg before confirming; never settles
    status: {
      type: String,
      enum: ["detected", "confirmed", "orphaned"],
      default: "detected",
    },
    // Set once this transfer has produced a Payment record, so a restart or a
    // re-run of the watch pass can never double-credit the same transfer.
    settledPaymentId: { type: mongoose.Schema.Types.ObjectId, ref: "Payment", default: null },
    seenAt: { type: Date, default: Date.now },
    confirmedAt: { type: Date, default: null },
  },
  { _id: false }
);

// A transfer of some OTHER token to this address. Recorded so the owner is told
// something arrived, but it never settles the invoice.
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

  // The token this address accepts. Stored per-address rather than read from
  // config at settlement time, so changing config later can never retroactively
  // reinterpret a payment that already happened.
  tokenSymbol: { type: String, required: true },
  tokenContract: { type: String, required: true },
  tokenDecimals: { type: Number, required: true },

  // Rate snapshot taken when the address was issued. Both sides are stored so
  // attribution is unambiguous later, however the rate has moved since.
  ngnBalanceAtIssue: { type: Number, required: true },
  expectedAmount: { type: String, required: true }, // raw token units, string
  rateNgnPerToken: { type: Number, required: true },
  rateFetchedAt: { type: Date, required: true },

  status: {
    type: String,
    enum: ["active", "expired", "paid", "swept", "revoked"],
    default: "active",
    index: true,
  },

  observed: { type: [observedTxSchema], default: [] },
  foreign: { type: [foreignTxSchema], default: [] },

  // Where the watcher has scanned up to, so each pass only reads new blocks.
  lastScannedBlock: { type: Number, default: 0 },

  expiresAt: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now },
});

// An index must NEVER be issued twice for the same user — reuse would make it
// impossible to attribute a payment to the right invoice. The allocation is
// already atomic ($inc); this unique index is the second line of defence that
// turns any logic slip into a hard write error rather than silent corruption.
paymentAddressSchema.index({ userId: 1, derivationIndex: 1 }, { unique: true });

// The watch pass scans active addresses per chain.
paymentAddressSchema.index({ status: 1, chainId: 1 });

module.exports = mongoose.model("PaymentAddress", paymentAddressSchema);
