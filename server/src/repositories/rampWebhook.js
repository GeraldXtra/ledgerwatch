const mongoose = require("mongoose");
const RampOrder = require("../models/RampOrder");
const User = require("../models/User");

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = {
  orderByPartnerId: (partnerOrderId) => RampOrder.findOne({ partnerOrderId: String(partnerOrderId) }).lean(),
  accountExists: async (id) => mongoose.isValidObjectId(id) && Boolean(await User.exists({ _id: id })),
  accountByWallet: (wallet, evm) =>
    User.findOne(
      evm ? { walletAddress: new RegExp(`^${escapeRegExp(wallet)}$`, "i") } : { "chainAddresses.address": String(wallet) }
    )
      .select("_id")
      .lean(),
  updateByPartnerId: (partnerOrderId, set) =>
    RampOrder.findOneAndUpdate({ partnerOrderId: String(partnerOrderId) }, { $set: set }, { new: true }),
  upsertByProviderId: (providerOrderId, set) =>
    RampOrder.findOneAndUpdate(
      { providerOrderId: String(providerOrderId) },
      { $set: set, $setOnInsert: { createdAt: new Date() } },
      { new: true, upsert: true }
    ),
  claimNotice: (orderId, outcome) =>
    RampOrder.findOneAndUpdate(
      { _id: orderId, notifiedOutcome: { $ne: outcome } },
      { $set: { notifiedOutcome: outcome } },
      { new: true }
    ).lean(),
};
