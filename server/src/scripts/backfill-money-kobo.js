const mongoose = require("mongoose");
const Debt = require("../models/Debt");
const Payment = require("../models/Payment");
const PaymentAddress = require("../models/PaymentAddress");
const { nairaToKobo, hasWholeKobo } = require("../domain/money");

const TARGETS = [
  { name: "invoices", Model: Debt, from: "amount", to: "amountKobo" },
  { name: "payments", Model: Payment, from: "amount", to: "amountKobo" },
  { name: "payment addresses", Model: PaymentAddress, from: "settledNgn", to: "settledKobo" },
];

async function planFor({ Model, from, to }) {
  const rows = await Model.find({}).select(`_id ${from} ${to}`).lean();
  const missing = [];
  const drifted = [];
  const fractional = [];
  for (const row of rows) {
    const naira = Number(row[from] || 0);
    const kobo = nairaToKobo(naira);
    if (!hasWholeKobo(naira)) fractional.push({ _id: row._id, naira, kobo });
    if (row[to] === undefined || row[to] === null) missing.push({ _id: row._id, kobo });
    else if (row[to] !== kobo) drifted.push({ _id: row._id, stored: row[to], expected: kobo });
  }
  return { total: rows.length, missing, drifted, fractional };
}

async function backfillMoney({ apply = false, rollback = false } = {}) {
  const report = [];
  for (const target of TARGETS) {
    if (rollback) {
      const result = apply
        ? await target.Model.updateMany({ [target.to]: { $exists: true } }, { $unset: { [target.to]: "" } })
        : { modifiedCount: await target.Model.countDocuments({ [target.to]: { $exists: true } }) };
      report.push({ name: target.name, rolledBack: result.modifiedCount || 0 });
      continue;
    }
    const plan = await planFor(target);
    let written = 0;
    if (apply && plan.missing.length) {
      const ops = plan.missing.map((row) => ({
        updateOne: {
          filter: { _id: row._id, [target.to]: { $exists: false } },
          update: { $set: { [target.to]: row.kobo } },
        },
      }));
      for (let i = 0; i < ops.length; i += 500) {
        const res = await target.Model.bulkWrite(ops.slice(i, i + 500), { ordered: false });
        written += res.modifiedCount || 0;
      }
    }
    report.push({
      name: target.name,
      total: plan.total,
      missing: plan.missing.length,
      written,
      drifted: plan.drifted,
      fractional: plan.fractional,
    });
  }
  return report;
}

function print(report, { apply, rollback }) {
  console.log(`\nMODE: ${rollback ? "ROLLBACK " : ""}${apply ? "APPLY (writing)" : "DRY RUN (nothing is written)"}\n`);
  for (const r of report) {
    if (rollback) {
      console.log(`${r.name}: ${r.rolledBack} kobo field(s) ${apply ? "removed" : "would be removed"}`);
      continue;
    }
    console.log(
      `${r.name}: ${r.total} row(s), ${r.missing} without kobo, ${apply ? `${r.written} written` : "none written"}`
    );
    for (const f of r.fractional) {
      console.log(`  NOTE ${f._id}: ${f.naira} naira is not a whole number of kobo; it is stored as ${f.kobo} kobo`);
    }
    for (const d of r.drifted) {
      console.log(`  DRIFT ${d._id}: stores ${d.stored} kobo, the naira amount says ${d.expected}. Left unchanged; check this row.`);
    }
  }
  if (!apply) console.log(`\nRun again with --apply to write${rollback ? " the rollback" : ""}.`);
}

if (require.main === module) {
  require("dotenv").config();
  const connectDB = require("../config/db");
  const apply = process.argv.includes("--apply");
  const rollback = process.argv.includes("--rollback");
  connectDB()
    .then(() => backfillMoney({ apply, rollback }))
    .then((report) => {
      print(report, { apply, rollback });
      return mongoose.disconnect();
    })
    .then(() => process.exit(0))
    .catch(async (err) => {
      console.error("backfill-money-kobo failed:", err.message);
      await mongoose.disconnect().catch(() => {});
      process.exit(1);
    });
}

module.exports = { backfillMoney };
