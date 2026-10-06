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

  /**
   * THE ISSUANCE QUOTE — WRITTEN ONCE, NEVER AGAIN. (LW-005, BUILD_PLAN P1-1,
   * ARCHITECTURE.md invariant 6: "PaymentAddress.quote.* is immutable after
   * issuance".)
   *
   * WHAT WAS WRONG. There was only one set of figures, and
   * `resyncActivePaymentAddress` overwrote them after every partial settlement
   * and every edit to the invoice. So the record of WHAT THE PAYER WAS ACTUALLY
   * ASKED FOR was destroyed by the first thing that changed the balance.
   *
   * Why that matters more than it sounds. A payer is told "send exactly 62.50
   * USDC". They send it. In between, a bank transfer settles part of the same
   * invoice, resync rewrites the expectation to 22.50, and now nothing anywhere
   * can answer the only question that matters when a payment is disputed: did
   * this person send what they were told to send? 62.50 against a 22.50
   * expectation reads as a 40 USDC overpayment, when in fact they paid exactly
   * what the invoice asked. The audit trail for every crypto payment was one
   * bank transfer away from being wrong.
   *
   * So the two ideas are now two fields, because they were always two ideas:
   *
   *   quote.*        what this address was ISSUED for. Frozen. The contract with
   *                  the payer, and the thing a dispute is settled against.
   *   expectedUsdc   what is STILL OWED right now. Rewritten by resync, which is
   *   invoiceBalanceNgn   correct and is what settlement compares against.
   *
   * `ngnPerUsd` and `rateTimestamp` stay at the top level as well as inside the
   * quote: settlement converts with them on every pass and moving them would
   * touch every caller for no gain. They were never rewritten, so they were
   * never part of this defect.
   */
  quote: {
    /** The invoice balance in naira at the moment this address was issued. */
    invoiceBalanceNgn: { type: Number },
    /** The exact figure the payer was asked to send. 2 dp, rounded UP. */
    expectedUsdc: { type: Number },
    /** The rate that figure was computed at. */
    ngnPerUsd: { type: Number },
    rateTimestamp: { type: Date },
    rateIsFallback: { type: Boolean, default: false },
    issuedAt: { type: Date },
    /**
     * True for a row created before the quote was stored separately, and
     * back-filled from the CURRENT figures by
     * `scripts/backfill-issuance-quote.js`. Those figures may already have been
     * rewritten by a resync, so the back-filled quote is the best available
     * reconstruction and NOT evidence. Anything that settles a dispute must
     * check this flag before relying on the numbers beside it.
     */
    reconstructed: { type: Boolean, default: false },
  },

  // Rate snapshot taken when the address was issued. 1 USDC is treated as exactly
  // 1 USD, so `ngnPerUsd` is the only rate in play — no USDC/USD price is fetched.
  //
  // These two are the CURRENT expectation and are rewritten by resync. For what
  // the payer was originally quoted, read `quote.*` above.
  invoiceBalanceNgn: { type: Number, required: true },
  expectedUsdc: { type: Number, required: true }, // 2 dp, remaining, not the quote
  ngnPerUsd: { type: Number, required: true },
  rateTimestamp: { type: Date, required: true },
  /**
   * True when `ngnPerUsd` came from NGN_PER_USD_FALLBACK rather than the live
   * feed, because CoinGecko was unreachable at issuance.
   *
   * It has to be STORED, not just returned from the quote call, because the
   * quote is frozen into the invoice and settles it for the rest of its life.
   * `rateTimestamp` cannot carry this: the fallback path stamps it `new Date()`,
   * so a hardcoded constant looked in the interface like a rate fetched a second
   * ago, and the whole difference between it and the real market was absorbed by
   * the business, silently, on every invoice issued during an outage.
   */
  rateIsFallback: { type: Boolean, default: false },

  // Running totals maintained by the watch pass, so the invoice can show
  // received-so-far and still-needed without recomputing from logs each render.
  receivedUsdc: { type: Number, default: 0 }, // confirmed only
  settledNgn: { type: Number, default: 0 },
  overpaidUsdc: { type: Number, default: 0 },

  /**
   * Money that arrived at this address when the invoice owed nothing.
   *
   * It exists because the alternative was a bare `return null` that threw a
   * confirmed on chain payment away (LW-002). One is sitting in this database:
   * 7.35 USDC, 131 confirmations deep, swept to the owner's wallet, with no
   * Payment row anywhere. The money was real and the ledger has no memory of it.
   *
   * ASSIGNED from the running total of confirmed transfers that never became a
   * Payment, not accumulated. That total is already cumulative, so adding to it
   * counts the same transfer once per pass. It is written on every grace scan
   * for the life of the address, so it has to converge rather than drift.
   * (overpaidUsdc is the opposite case and genuinely does accumulate, because
   * each settlement contributes a separate excess.)
   */
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
  // Set when the address holds more than every transfer we know about explains,
  // and the recent-window scan could not find the transaction responsible. The
  // money is real and visible on the explorer, so this is surfaced as a warning
  // rather than left as a silent discrepancy. Cleared once it is explained.
  unidentifiedBalanceAt: { type: Date, default: null },
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

/**
 * ONE ACTIVE ADDRESS PER INVOICE, enforced by the database.
 *
 * The service already refuses to issue a second one, but it does so by looking
 * first and creating afterwards — two steps with a gap between them. Two
 * requests arriving together (a double tap, a retried request, two tabs) both
 * look, both find nothing, and both create. Neither of the unique indexes above
 * stops that: the addresses differ and so do the derivation indices. The result
 * is one invoice with two live receiving addresses, splitting a customer's
 * payments between them and confusing who paid what.
 *
 * Every other invariant in this file that matters is backed by a constraint
 * rather than by a check, and this is now too. Partial, so the many closed
 * addresses an invoice accumulates over its life do not collide with each other.
 *
 * Keyed on {debtId, status} rather than on debtId alone for two reasons: the
 * field already declares a plain index and duplicating the key pattern is a
 * Mongoose warning, and inside a filter of status "active" the pair is exactly
 * debtId, so the guarantee is identical.
 *
 * If this index fails to build on an existing deployment, the database already
 * holds an invoice with two active addresses: find it, revoke the one that has
 * received nothing, and let the build run again. It does not stop the server.
 */
paymentAddressSchema.index(
  { debtId: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: "active" } }
);

module.exports = mongoose.model("PaymentAddress", paymentAddressSchema);
