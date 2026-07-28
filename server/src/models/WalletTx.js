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
  createdAt: { type: Date, default: Date.now },
});

walletTxSchema.index({ userId: 1, chainId: 1, createdAt: -1 });

module.exports = mongoose.model("WalletTx", walletTxSchema);
