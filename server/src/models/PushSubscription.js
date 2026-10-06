const mongoose = require("mongoose");

/**
 * A browser Web Push subscription, scoped to a user. `endpoint` IS the push
 * channel, and one endpoint per USER is unique, so re-subscribing the same
 * browser upserts rather than duplicating. Dead endpoints (404/410 from the push
 * service) are pruned automatically by push.service.
 *
 * THE UNIQUENESS IS ON THE PAIR, not on the endpoint alone, because the two
 * halves of this had contradicted each other since the LW-009 fix. The
 * controller upserts on {endpoint, userId} while the index insisted an endpoint
 * could belong to exactly one account, so a second account signing in on the
 * same browser — a shared computer, or a demo account alongside a real one —
 * found no row of its own, tried to insert, and was rejected by the index. The
 * generic handler turned that into a 500 reading "Failed to subscribe", so the
 * user was told notifications had failed with no reason, permanently: a service
 * worker registration keeps the same endpoint, so retrying never helped, and the
 * channel the product uses to say money arrived stayed off for that account.
 *
 * MIGRATION: Mongoose does not drop an index that has left the schema, so an
 * existing deployment keeps enforcing the old global rule until
 * `node src/scripts/migrate-push-endpoint-index.js --apply` has been run.
 */
const pushSubscriptionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  endpoint: { type: String, required: true },
  keys: {
    p256dh: { type: String, required: true },
    auth: { type: String, required: true },
  },
  userAgent: { type: String },
  createdAt: { type: Date, default: Date.now },
});

// One row per browser per account. Also the index the delivery path reads by.
pushSubscriptionSchema.index({ endpoint: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model("PushSubscription", pushSubscriptionSchema);
