require("dotenv").config();

const mongoose = require("mongoose");
const connectDB = require("../config/db");
const Alert = require("../models/Alert");

async function main() {
  await connectDB();

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
    await Alert.updateMany(
      { _id: { $in: stale } },
      { $set: { status: "dismissed", userAction: "dismiss", actedAt: new Date() } }
    );
  }

  return { scanned: pending.length, kept: keptWatches.size, dismissed: stale.length };
}

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
