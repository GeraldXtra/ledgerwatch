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
    // Arrived after the address stopped accepting payment. It still settles (the
    // payer sent what they were quoted) but the owner is told it was late, so a
    // settlement landing on a closed-looking invoice is never a surprise.
    late: { type: Boolean, default: false },
    seenAt: { type: Date, default: Date.now },
    confirmedAt: { type: Date, default: null },
  },
  { _id: false }
);

// One sweep of this address's balance to the owner's main wallet. Outbound and
// user-signed, so this is a record of something the user personally approved.
const sweepSchema = new mongoose.Schema(
  {
    txHash: { type: String, required: true },
    destination: { type: String, required: true },
    amountUsdc: { type: Number, required: true },
    // The separate native-token transfer that paid for the sweep's gas, when the
    // derived address had no native balance of its own. Null when it did.
    gasFundedTxHash: { type: String, default: null },
    at: { type: Date, default: Date.now },
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

  // Rate snapshot taken when the address was issued. 1 USDC is treated as exactly
  // 1 USD, so `ngnPerUsd` is the only rate in play — no USDC/USD price is fetched.
  // Both the NGN balance and the USDC figure are stored, so attribution stays
  // unambiguous however far the rate moves afterwards.
  invoiceBalanceNgn: { type: Number, required: true },
  expectedUsdc: { type: Number, required: true }, // 2 dp, rounded UP at issue
  ngnPerUsd: { type: Number, required: true },
  rateTimestamp: { type: Date, required: true },

  // Running totals maintained by the watch pass, so the invoice can show
  // received-so-far and still-needed without recomputing from logs each render.
  receivedUsdc: { type: Number, default: 0 }, // confirmed only
  settledNgn: { type: Number, default: 0 },
  overpaidUsdc: { type: Number, default: 0 },

  status: {
    type: String,
    enum: ["active", "expired", "paid", "swept", "revoked"],
    default: "active",
    index: true,
  },

  observed: { type: [observedTxSchema], default: [] },
  foreign: { type: [foreignTxSchema], default: [] },
  sweeps: { type: [sweepSchema], default: [] },

  // Where the watcher has scanned up to, so each pass only reads new blocks.
  lastScannedBlock: { type: Number, default: 0 },

  expiresAt: { type: Date, required: true },
  // When the address actually flipped to `expired`. The grace watch measures its
  // 30 day window from here rather than from expiresAt, so an address that was
  // expired late (server down over the boundary) still gets its full grace.
  expiredAt: { type: Date, default: null },
  // Last time the watcher looked at this address, of either kind. The grace pass
  // throttles on this so it cannot re-scan every expired address every minute.
  lastWatchedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
});

// An index must NEVER be issued twice for the same user — reuse would make it
// impossible to attribute a payment to the right invoice. The allocation is
// already atomic ($inc); this unique index is the second line of defence that
// turns any logic slip into a hard write error rather than silent corruption.
paymentAddressSchema.index({ userId: 1, derivationIndex: 1 }, { unique: true });

/**
 * No address may EVER back two invoices, across all accounts.
 *
 * The index above is scoped per user, so it cannot catch this: keystores are
 * per-account, and somebody who imports the same recovery phrase into two
 * accounts derives identical addresses at identical indices. Both accounts would
 * then hand the same address to different debtors and one payment would settle
 * the wrong invoice. This turns that into a hard write error instead of money
 * quietly credited to the wrong person. Addresses are never reused by design, so
 * uniqueness holds as an invariant.
 */
paymentAddressSchema.index({ address: 1 }, { unique: true });

// The watch pass scans active addresses per chain.
paymentAddressSchema.index({ status: 1, chainId: 1 });

// The grace pass selects expired addresses least-recently watched, so it reads
// this compound index rather than scanning every expired row each minute.
paymentAddressSchema.index({ status: 1, lastWatchedAt: 1 });

module.exports = mongoose.model("PaymentAddress", paymentAddressSchema);
