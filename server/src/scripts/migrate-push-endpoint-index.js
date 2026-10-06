/**
 * Replace the stale global unique index on PushSubscription.endpoint with
 * {endpoint, userId}.
 *
 * WHY THIS EXISTS
 *
 * `endpoint_1` was unique across the whole collection, so a browser's push
 * channel could belong to exactly one account. The controller, since the LW-009
 * fix, upserts on {endpoint, userId}. The two contradicted each other: a second
 * account signing in on the same browser — a shared computer, or the demo
 * account alongside a real one — matched no row of its own, tried to insert, and
 * was rejected by the index. The caller turned that into a 500 reading "Failed
 * to subscribe", so the owner was told notifications had failed with no reason
 * and no way to fix it, since a service worker registration keeps the same
 * endpoint for the life of the installation.
 *
 * Mongoose does not drop an index that has left the schema, so this has to be
 * run against every existing deployment.
 *
 * Idempotent. Safe to run repeatedly; the second run reports nothing to do.
 *
 *   node src/scripts/migrate-push-endpoint-index.js            (dry run, default)
 *   node src/scripts/migrate-push-endpoint-index.js --apply
 */
require("dotenv").config();
const mongoose = require("mongoose");

const APPLY = process.argv.includes("--apply");
const COLLECTION = "pushsubscriptions";
const STALE = "endpoint_1";
const WANTED = "endpoint_1_userId_1";

/**
 * ONLY WHEN RUN DIRECTLY.
 *
 * This body used to execute on `require`, so anything that loaded the scripts
 * directory — a test sweep, a tooling pass, an editor's module graph — connected
 * to Mongo and started a migration. Guarded on being the process entry point,
 * which is what `node src/scripts/<name>.js` gives and a require never does.
 */
if (require.main === module) {
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

    const names = (await db.listCollections().toArray()).map((c) => c.name);
    if (!names.includes(COLLECTION)) {
      console.log(`  ${COLLECTION} does not exist yet. Nothing to migrate.`);
      await mongoose.disconnect();
      process.exit(0);
    }

    const idx = await db.collection(COLLECTION).indexes();
    console.log(`  ${COLLECTION} indexes:`);
    for (const i of idx) console.log(`    ${i.name}${i.unique ? "  UNIQUE" : ""}`);

    const stale = idx.find((i) => i.name === STALE);
    const wanted = idx.find((i) => i.name === WANTED);

    // The replacement is created first, so the collection is never left without a
    // uniqueness guard on the pair.
    if (!wanted) {
      console.log(`\n    ${WANTED} is missing and must be created.`);
      if (APPLY) {
        await db.collection(COLLECTION).createIndex({ endpoint: 1, userId: 1 }, { unique: true });
        console.log(`    created ${WANTED} (unique)`);
      }
    } else {
      console.log(`\n    ${WANTED} is already present.`);
    }

    if (stale) {
      console.log(`    ${STALE} is unique across every account and MUST be dropped.`);
      if (APPLY) {
        await db.collection(COLLECTION).dropIndex(STALE);
        console.log(`    dropped ${STALE}`);
      }
    } else {
      console.log(`    ${STALE} is already gone.`);
    }

    if (!APPLY) {
      console.log("\nDry run complete. Re-run with --apply to make the changes.");
    } else {
      console.log("\nDone.");
    }

    await mongoose.disconnect();
    process.exit(0);
  })().catch((err) => {
    console.error("Migration failed:", err.message);
    process.exit(1);
  });
}
