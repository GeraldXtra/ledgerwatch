const mongoose = require("mongoose");
const Debt = require("../models/Debt");
const User = require("../models/User");
const { formatInvoiceNumber } = require("../services/invoice.service");

function numberOf(invoiceNumber) {
  const match = /^INV-(\d+)$/.exec(String(invoiceNumber || ""));
  return match ? Number(match[1]) : 0;
}

async function backfillInvoiceNumbers({ apply = false } = {}) {
  const owners = await Debt.distinct("userId", { invoiceNumber: null });
  const report = [];
  for (const userId of owners) {
    const user = await User.findById(userId).select("invoiceSeq").lean();
    if (!user) {
      report.push({ userId: String(userId), skipped: "the account no longer exists" });
      continue;
    }
    const numbered = await Debt.find({ userId, invoiceNumber: { $type: "string" } }).select("invoiceNumber").lean();
    let next = Math.max(Number(user.invoiceSeq) || 0, ...numbered.map((d) => numberOf(d.invoiceNumber)));
    const missing = await Debt.find({ userId, invoiceNumber: null }).sort({ createdAt: 1, _id: 1 }).select("_id").lean();
    const plan = missing.map((d) => ({ _id: d._id, invoiceNumber: formatInvoiceNumber(++next) }));
    let written = 0;
    if (apply && plan.length) {
      for (const row of plan) {
        const res = await Debt.updateOne({ _id: row._id, invoiceNumber: null }, { $set: { invoiceNumber: row.invoiceNumber } });
        written += res.modifiedCount || 0;
      }
      await User.updateOne({ _id: userId }, { $max: { invoiceSeq: next } });
    }
    report.push({
      userId: String(userId),
      missing: plan.length,
      first: plan.length ? plan[0].invoiceNumber : null,
      last: plan.length ? plan[plan.length - 1].invoiceNumber : null,
      written,
    });
  }
  return report;
}

if (require.main === module) {
  require("dotenv").config();
  const connectDB = require("../config/db");
  const apply = process.argv.includes("--apply");
  connectDB()
    .then(() => backfillInvoiceNumbers({ apply }))
    .then((report) => {
      console.log(`\nMODE: ${apply ? "APPLY (writing)" : "DRY RUN (nothing is written)"}\n`);
      if (!report.length) console.log("Every invoice already has a number.");
      for (const r of report) {
        if (r.skipped) console.log(`account ${r.userId}: skipped, ${r.skipped}`);
        else console.log(`account ${r.userId}: ${r.missing} invoice(s) numbered ${r.first} to ${r.last}${apply ? `, ${r.written} written` : ""}`);
      }
      if (!apply && report.length) console.log("\nRun again with --apply to write.");
      return mongoose.disconnect();
    })
    .then(() => process.exit(0))
    .catch(async (err) => {
      console.error("backfill-invoice-numbers failed:", err.message);
      await mongoose.disconnect().catch(() => {});
      process.exit(1);
    });
}

module.exports = { backfillInvoiceNumbers };
