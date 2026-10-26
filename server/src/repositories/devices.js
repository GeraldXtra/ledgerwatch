const PushSubscription = require("../models/PushSubscription");
const NativeDevice = require("../models/NativeDevice");
const { ownerId } = require("./scoped");

function endpointOf(value) {
  return String(value || "");
}

module.exports = {
  releaseFromOtherAccounts: (endpoint, keepUserId) =>
    PushSubscription.deleteMany({ endpoint: endpointOf(endpoint), userId: { $ne: ownerId(keepUserId) } }),
  releaseTokenFromOtherAccounts: (token, keepUserId) =>
    NativeDevice.deleteMany({ token: endpointOf(token), userId: { $ne: ownerId(keepUserId) } }),
  ownerOfEndpoint: async (endpoint) => {
    const row = await PushSubscription.findOne({ endpoint: endpointOf(endpoint) }).select("userId").lean();
    return row ? row.userId : null;
  },
  forgetEndpoint: (endpoint) => PushSubscription.deleteMany({ endpoint: endpointOf(endpoint) }),
};
