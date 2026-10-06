/**
 * One-off cleanup for the runaway-alert bug.
 *
 * Before the pending-alert guard landed in runPricePass, a watch whose condition
 * stayed true re-fired on every automation pass, stacking hundreds of pending
 * alerts. This leaves exactly ONE actionable alert per watch — the most recent.
 *
 * Non-destructive by design: nothing is deleted. Stale alerts are moved to
 * "dismissed", the same terminal state the user's own Dismiss button produces,
 * so the alert history stays truthful and the history view still reflects what
 * actually happened.
 *
 * Safe to re-run: once cleaned, a second run finds nothing to do.
 *
 * Run:  npm run dedupe-alerts
 */
require("dotenv").config();

const mongoose = require("mongoose");
const connectDB = require("../config/db");
const Alert = require("../models/Alert");

async function main() {
  await connectDB();

  // Newest first, so the first alert seen for a watch is the one to keep.
  const pending = await Alert.find({ status: "pending" })
    .select("_id watchId createdAt")
    .sort({ createdAt: -1 })
    .lean();

  if (pending.length === 0) {
    return { scanned: 0, kept: 0, dismissed: 0 };
  }

  const keptWatches = new Set();
  const stale = [];

  for (const a of pending) {
    const key = String(a.watchId);
    if (keptWatches.has(key)) stale.push(a._id);
    else keptWatches.add(key);
  }

  if (stale.length > 0) {
    /**
     * THE SAME TERMINAL STATE THE DISMISS BUTTON PRODUCES, which means all three
     * fields and not just the status word.
     *
     * This wrote `status` alone, while the real handler also stamps `userAction`
     * and `actedAt` — the pair the Alert model exists to keep, so history can
     * show recommendation against decision. After a run the history therefore
     * showed alerts as dismissed with no record of who or when, which is not the
     * state the comment above promises. The database holds over a thousand
     * alerts waiting for this script, so the inconsistency would have been the
     * bulk of the history rather than a corner of it.
     *
     * `dismissedBy` is deliberately absent from the model, so the honest record
     * of "the system dismissed this, not the user" is that userAction says
     * dismiss and actedAt is the moment the cleanup ran, all in one batch.
     */
    await Alert.updateMany(
      { _id: { $in: stale } },
      { $set: { status: "dismissed", userAction: "dismiss", actedAt: new Date() } }
    );
  }

  return { scanned: pending.length, kept: keptWatches.size, dismissed: stale.length };
}

/**
 * ONLY WHEN RUN DIRECTLY.
 *
 * This ran on `require`. Anything that loaded the scripts directory — a test
 * sweep, or a tooling pass that requires every module to check it parses —
 * connected to whatever MONGO_URI pointed at and did the work. During this
 * audit exactly that happened: a module-load check ran dedupe-alerts against
 * the development database and dismissed eight duplicate pending alerts.
 *
 * `require.main === module` is true for `node <this file>` and false for every
 * require, which is the distinction that was missing.
 */
if (require.main === module) {
  main()
    .then((r) => {
      if (r.scanned === 0) {
        console.log("No pending alerts found. Nothing to clean up.");
      } else {
        console.log(
          `Pending alerts scanned: ${r.scanned}\n` +
            `Kept pending:          ${r.kept} (one per watch)\n` +
            `Dismissed as stale:    ${r.dismissed}`
        );
      }
      return mongoose.disconnect();
    })
    .then(() => process.exit(0))
    .catch(async (err) => {
      console.error("dedupe-alerts failed:", err.message);
      await mongoose.disconnect().catch(() => {});
      process.exit(1);
    });
}
