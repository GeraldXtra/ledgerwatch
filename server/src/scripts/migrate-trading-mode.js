/**
 * Backfill `mode` on the trading collections, and replace the stale unique index
 * on Portfolio.
 *
 * WHY THIS EXISTS
 *
 * Splitting paper from live added a `mode` field to Watch, Alert, Portfolio and
 * SimTrade. A Mongoose `default` only applies to documents created AFTER the
 * change, so every existing row had no `mode` at all and matched neither book.
 * The visible symptom was "Could not load Portfolio" on paper trading: the
 * lookup for `{userId, mode:"paper"}` found nothing, tried to create a second
 * portfolio, and collided with the old `userId_1` unique index, which Mongoose
 * does not drop on its own.
 *
 * Everything that existed before the split was simulated, so it all becomes
 * "paper". Nothing here can turn a paper row into a live one.
 *
 * Idempotent. Safe to run repeatedly; the second run reports zero changes.
 *
 *   node src/scripts/migrate-trading-mode.js            (dry run, default)
 *   node src/scripts/migrate-trading-mode.js --apply
 */
require("dotenv").config();
const mongoose = require("mongoose");

const APPLY = process.argv.includes("--apply");
const COLLECTIONS = ["portfolios", "watches", "alerts", "simtrades"];

(async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error("MONGO_URI is not set.");
    process.exit(1);
  }
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  console.log(`Connected to ${mongoose.connection.name}`);
  console.log(APPLY ? "MODE: APPLY (writing)\n" : "MODE: DRY RUN (nothing is written)\n");

  let touched = 0;
  for (const name of COLLECTIONS) {
    const missing = await db.collection(name).countDocuments({ mode: { $exists: false } });
    console.log(`  ${name.padEnd(12)} ${String(missing).padStart(5)} document(s) without a mode`);
    if (missing && APPLY) {
      const r = await db.collection(name).updateMany({ mode: { $exists: false } }, { $set: { mode: "paper" } });
      console.log(`  ${" ".repeat(12)} -> set mode:"paper" on ${r.modifiedCount}`);
    }
    touched += missing;
  }

  /**
   * The index swap. `userId_1` being unique is what made a second book
   * impossible, so it has to go before a live portfolio can ever be created.
   * The uniqueness still matters — two paper books for one person would split
   * their cash silently — so it moves onto the pair.
   */
  console.log("\n  portfolios indexes:");
  const idx = await db.collection("portfolios").indexes();
  for (const i of idx) console.log(`    ${i.name}${i.unique ? "  UNIQUE" : ""}`);

  const stale = idx.find((i) => i.name === "userId_1");
  const wanted = idx.find((i) => i.name === "userId_1_mode_1");

  if (stale) {
    console.log("\n    userId_1 is unique on its own and MUST be dropped.");
    if (APPLY) {
      await db.collection("portfolios").dropIndex("userId_1");
      console.log("    dropped userId_1");
    }
  }
  if (!wanted) {
    console.log("    userId_1_mode_1 is missing and must be created.");
    if (APPLY) {
      // Backfill first, or documents with no mode collide on null.
      await db.collection("portfolios").createIndex({ userId: 1, mode: 1 }, { unique: true });
      console.log("    created userId_1_mode_1 (unique)");
    }
  }

  if (!APPLY) {
    console.log(`\nDry run complete. ${touched} document(s) would change. Re-run with --apply.`);
  } else {
    console.log("\nDone.");
  }

  await mongoose.disconnect();
  process.exit(0);
})().catch((err) => {
  console.error("Migration failed:", err.message);
  process.exit(1);
});
