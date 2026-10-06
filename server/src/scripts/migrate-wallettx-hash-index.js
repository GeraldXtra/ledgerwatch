/**
 * Replace the stale global unique index on WalletTx.hash with {hash, userId}.
 *
 * WHY THIS EXISTS
 *
 * `hash_1` was unique across the WHOLE collection, so a transaction hash could
 * only ever belong to one account. A single blockchain transaction can pay
 * several addresses — a batch payout, an exchange withdrawal covering two
 * customers, or simply one LedgerWatch user paying another — and in that case
 * whichever account recorded the hash first claimed it. The second user's
 * inbound scan found the hash already present, wrote nothing, and reported no
 * error: the money arrived, the balance was right, and the transfer was absent
 * from their history with nothing to explain why.
 *
 * The uniqueness still matters per account (a retry, a double click or two open
 * tabs must not record the same transaction twice), so it moves onto the pair.
 * The same-wallet behaviour the wallet history header documents is unchanged:
 * two token transfers inside one transaction to the same user still collide and
 * the first is kept.
 *
 * Mongoose does not drop an index that has left the schema, so this has to be
 * run against every existing deployment or the old rule stays in force there
 * while the code believes it is gone.
 *
 * Idempotent. Safe to run repeatedly; the second run reports nothing to do.
 *
 *   node src/scripts/migrate-wallettx-hash-index.js            (dry run, default)
 *   node src/scripts/migrate-wallettx-hash-index.js --apply
 */
require("dotenv").config();
const mongoose = require("mongoose");

const APPLY = process.argv.includes("--apply");
const COLLECTION = "wallettxes";
const STALE = "hash_1";
const WANTED = "hash_1_userId_1";

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

    /**
     * Create the replacement BEFORE dropping the old one, so there is never a
     * moment with no uniqueness guard at all on a collection the wallet writes to.
     */
    if (!wanted) {
      console.log(`\n    ${WANTED} is missing and must be created.`);
      if (APPLY) {
        await db.collection(COLLECTION).createIndex({ hash: 1, userId: 1 }, { unique: true });
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
