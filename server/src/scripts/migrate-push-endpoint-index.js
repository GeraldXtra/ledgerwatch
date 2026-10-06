require("dotenv").config();
const mongoose = require("mongoose");

const APPLY = process.argv.includes("--apply");
const COLLECTION = "pushsubscriptions";
const STALE = "endpoint_1";
const WANTED = "endpoint_1_userId_1";

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
