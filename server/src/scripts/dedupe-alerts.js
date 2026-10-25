const mongoose = require("mongoose");
const connectDB = require("../config/db");
const Alert = require("../models/Alert");

function findStale(pending) {
  const keptWatches = new Set();
  const stale = [];
  for (const a of pending) {
    const key = String(a.watchId);
    if (keptWatches.has(key)) stale.push(a._id);
    else keptWatches.add(key);
  }
  return { kept: keptWatches.size, stale };
}

async function dedupeAlerts({ apply = false } = {}) {
  const pending = await Alert.find({ status: "pending" })
    .select("_id watchId createdAt")
    .sort({ createdAt: -1 })
    .lean();

  const { kept, stale } = findStale(pending);

  if (apply && stale.length > 0) {
    await Alert.updateMany(
      { _id: { $in: stale }, status: "pending" },
      { $set: { status: "dismissed", userAction: "dismiss", actedAt: new Date() } }
    );
  }

  return { apply, scanned: pending.length, kept, stale: stale.length, dismissed: apply ? stale.length : 0 };
}

if (require.main === module) {
  require("dotenv").config();
  const apply = process.argv.includes("--apply");
  console.log(`\nMODE: ${apply ? "APPLY (writing)" : "DRY RUN (nothing is written)"}\n`);
  connectDB()
    .then(() => dedupeAlerts({ apply }))
    .then((r) => {
      if (r.scanned === 0) {
        console.log("No pending alerts found. Nothing to clean up.");
      } else {
        console.log(
          `Pending alerts scanned: ${r.scanned}\n` +
            `Kept pending:          ${r.kept} (one per watch)\n` +
            (r.apply
              ? `Dismissed as stale:    ${r.dismissed}`
              : `Would dismiss:         ${r.stale}${r.stale ? "\nRun again with --apply to dismiss them." : ""}`)
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

module.exports = { dedupeAlerts, findStale };
