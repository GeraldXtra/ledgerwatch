const mongoose = require("mongoose");

/**
 * A browser Web Push subscription, scoped to a user. `endpoint` IS the push
 * channel and is globally unique, so re-subscribing the same browser upserts
 * rather than duplicating. Dead endpoints (404/410 from the push service) are
 * pruned automatically by push.service.
 */
const pushSubscriptionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  endpoint: { type: String, required: true, unique: true },
  keys: {
    p256dh: { type: String, required: true },
    auth: { type: String, required: true },
  },
  userAgent: { type: String },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("PushSubscription", pushSubscriptionSchema);
