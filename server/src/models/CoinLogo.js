const mongoose = require("mongoose");

const coinLogoSchema = new mongoose.Schema({
  coinId: { type: String, required: true, unique: true },
  symbol: { type: String, default: null },
  name: { type: String, default: null },
  image: { type: String, required: true },
  updatedAt: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("CoinLogo", coinLogoSchema);
