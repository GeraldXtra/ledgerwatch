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
   * Block this was mined in. Display and explorer ordering only.
   *
   * This comment used to say it doubled as the inbound-sync cursor, resumed from
   * max(blockNumber) per user and chain. It does not, and deliberately: the
   * cursor lives on `User.walletHistoryCursors`, whose own comment explains why
   * deriving it from the newest recorded transaction was abandoned — a wallet
   * that has received nothing has no row to derive from, so there is no floor and
   * the scan starts from scratch every time. Two comments describing opposite
   * designs is how somebody ends up implementing the wrong one.
   */
  blockNumber: { type: Number, default: null },

  // Swap-only. `value`/`symbol` above carry the INPUT side, so a swap reads as an
  // ordinary outgoing transfer to anything that does not know about swaps.
  tokenOut: { type: String, default: null },
  tokenOutSymbol: { type: String, default: null },
  amountOut: { type: String, default: null }, // decimal string: token amounts exceed IEEE-754
  minAmountOut: { type: String, default: null },
  feeTier: { type: Number, default: null }, // the V3 tier of the FIRST hop
  /**
   * The whole route as a readable string, e.g. "USDC > WETH > PEPE (500/3000)".
   * Multi-hop routing means the fee tier alone no longer describes the trade:
   * most long-tail tokens price better through the chain's wrapped native than
   * against a dollar, so a row showing one tier would not explain the price it
   * got. Null on every row written before routing existed.
   */
  route: { type: String, default: null },
  priceImpactPct: { type: Number, default: null },
  side: { type: String, enum: ["buy", "sell"], default: null },
  // The alert that prompted this, when it came from one, so the timeline runs
  // from suggestion through to settled trade.
  alertId: { type: mongoose.Schema.Types.ObjectId, ref: "Alert", default: null },

  createdAt: { type: Date, default: Date.now },
});

walletTxSchema.index({ userId: 1, chainId: 1, createdAt: -1 });

/**
 * One hash, one row PER ACCOUNT. Database-enforced rather than remembered in
 * process, so a retry, a double click or two open tabs cannot record the same
 * transaction twice. Mirrors the guard already on Payment.txHash.
 *
 * The uniqueness used to be on the hash alone, across the whole database, which
 * made one account's data suppress another's. A single blockchain transaction
 * can pay several addresses — that is exactly how a batch payout works — and if
 * two LedgerWatch users were paid by the same transaction, whichever account
 * recorded it first claimed the hash and the second user's inbound scan wrote
 * nothing. The transfer was simply absent from their history, with no error and
 * no warning, and it was equally true of one user paying another through the
 * app: the sender's outgoing row blocked the recipient's incoming one.
 *
 * The documented same-wallet behaviour is unchanged: two token transfers inside
 * one transaction to the SAME user still collide on this index and the first is
 * kept, which is what the wallet history header describes.
 *
 * MIGRATION: the legacy `hash_1` index is not dropped by Mongoose when a schema
 * index changes, so an existing deployment keeps enforcing the global rule until
 * `node src/scripts/migrate-wallettx-hash-index.js --apply` has been run
 * against it.
 */
walletTxSchema.index({ hash: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model("WalletTx", walletTxSchema);
