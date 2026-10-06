require("dotenv").config();
const mongoose = require("mongoose");

const APPLY = process.argv.includes("--apply");
const COLLECTIONS = ["portfolios", "watches", "alerts", "simtrades"];

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
}
