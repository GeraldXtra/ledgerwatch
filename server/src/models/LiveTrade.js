const mongoose = require("mongoose");

/**
 * A REAL, on-chain swap. Kept in its own collection, entirely separate from
 * SimTrade, so paper and live figures can never be summed together by accident.
 * Paper money and real money appearing in one total would be the single most
 * misleading thing this app could do.
 *
 * Only PUBLIC data is stored — addresses, amounts, hashes. Never a key.
 */
const liveTradeSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  chainId: { type: Number, required: true },

  // buy = stablecoin -> asset, sell = asset -> stablecoin. The wallet's
  // stablecoin balance is the live cash balance.
  side: { type: String, enum: ["buy", "sell"], required: true },

  tokenIn: { type: String, required: true },
  tokenInSymbol: { type: String, required: true },
  tokenInDecimals: { type: Number, required: true },
  tokenOut: { type: String, required: true },
  tokenOutSymbol: { type: String, required: true },
  tokenOutDecimals: { type: Number, required: true },

  // Decimal strings, not Numbers: token amounts routinely exceed what IEEE-754
  // can hold exactly, and a silently rounded amount is a wrong ledger.
  amountIn: { type: String, required: true },
  amountOut: { type: String, required: true },
  minAmountOut: { type: String, required: true },

  feeTier: { type: Number }, // the V3 tier actually routed through
  priceImpactPct: { type: Number },
  slippagePct: { type: Number },

  txHash: { type: String, required: true },
  status: { type: String, enum: ["pending", "confirmed", "failed"], default: "pending" },
  gasUsed: { type: String, default: null },
  blockNumber: { type: Number, default: null },

  // The alert that prompted this, when it came from one. Lets the timeline show
  // suggestion through to settled trade.
  alertId: { type: mongoose.Schema.Types.ObjectId, ref: "Alert", default: null },

  createdAt: { type: Date, default: Date.now },
  confirmedAt: { type: Date, default: null },
});

// One hash settles once. Database-enforced rather than remembered in process,
// so a retry, a restart or two tabs cannot record the same swap twice.
liveTradeSchema.index({ txHash: 1 }, { unique: true });
liveTradeSchema.index({ userId: 1, chainId: 1, createdAt: -1 });

module.exports = mongoose.model("LiveTrade", liveTradeSchema);
