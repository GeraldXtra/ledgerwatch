const mongoose = require("mongoose");

// Locally-recorded wallet transaction. We store only PUBLIC data (addresses, hash,
// amounts) — never keys. This gives an instant history that works even with no
// Alchemy key, and each row deep-links to the right block explorer.
const walletTxSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  chainId: { type: Number, required: true },
  hash: { type: String, required: true },
  from: { type: String, required: true },
  to: { type: String, required: true },
  value: { type: String, default: "0" }, // decimal string in the token's units
  symbol: { type: String, default: "ETH" },
  tokenAddress: { type: String, default: null }, // null => native transfer
  direction: { type: String, enum: ["out", "in"], default: "out" },
  status: { type: String, enum: ["pending", "confirmed", "failed"], default: "pending" },

  /**
   * Live DEX swaps are recorded HERE rather than in a parallel collection, so
   * they inherit the confirmation reconciliation and per-chain explorer links
   * that already exist, and appear in wallet history like any other transaction.
   *
   * `kind` stays "transfer" for everything written before this existed.
   */
  kind: { type: String, enum: ["transfer", "swap", "approval"], default: "transfer" },

  /**
   * Block this was mined in. Doubles as the incremental-sync cursor: the inbound
   * discovery scan resumes from max(blockNumber) for a user and chain, so it only
   * ever re-reads new blocks rather than re-walking the same window on every
   * History load.
   */
  blockNumber: { type: Number, default: null },

  // Swap-only. `value`/`symbol` above carry the INPUT side, so a swap reads as an
  // ordinary outgoing transfer to anything that does not know about swaps.
  tokenOut: { type: String, default: null },
  tokenOutSymbol: { type: String, default: null },
  amountOut: { type: String, default: null }, // decimal string: token amounts exceed IEEE-754
  minAmountOut: { type: String, default: null },
  feeTier: { type: Number, default: null }, // the V3 tier actually routed through
  priceImpactPct: { type: Number, default: null },
  side: { type: String, enum: ["buy", "sell"], default: null },
  // The alert that prompted this, when it came from one, so the timeline runs
  // from suggestion through to settled trade.
  alertId: { type: mongoose.Schema.Types.ObjectId, ref: "Alert", default: null },

  createdAt: { type: Date, default: Date.now },
});

walletTxSchema.index({ userId: 1, chainId: 1, createdAt: -1 });

/**
 * One hash, one row. Database-enforced rather than remembered in process, so a
 * retry, a double click or two open tabs cannot record the same transaction
 * twice. Mirrors the guard already on Payment.txHash.
 */
walletTxSchema.index({ hash: 1 }, { unique: true });

module.exports = mongoose.model("WalletTx", walletTxSchema);
