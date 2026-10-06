require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const PaymentAddress = require("../models/PaymentAddress");
const Debt = require("../models/Debt");

const APPLY = process.argv.includes("--apply");

function usdcForNgn(ngn, rate) {
  if (!(rate > 0)) return null;
  return Math.ceil((ngn / rate) * 100) / 100;
}

async function main() {
  await connectDB();
  console.log(`\nMODE: ${APPLY ? "APPLY (writing)" : "DRY RUN (nothing is written)"}\n`);

  const rows = await PaymentAddress.find({
    $or: [{ quote: { $exists: false } }, { "quote.issuedAt": { $exists: false } }],
  });

  console.log(`${rows.length} address(es) without a stored issuance quote.\n`);
  if (!rows.length) {
    await mongoose.disconnect();
    return;
  }

  let exact = 0;
  let reconstructed = 0;
  let skipped = 0;

  for (const pa of rows) {
    const debt = await Debt.findById(pa.debtId).select("amount").lean();

    if (!pa.ngnPerUsd || !pa.rateTimestamp) {
      console.log(`  SKIP  ${pa.address}  no stored rate`);
      skipped++;
      continue;
    }

    const settledNothing = !pa.settledNgn || pa.settledNgn === 0;
    const balanceIntact =
      debt && Math.abs((pa.invoiceBalanceNgn || 0) - (debt.amount || 0)) < 0.005;
    const isExact = settledNothing && balanceIntact;

    let quotedNgn;
    if (isExact) {
      quotedNgn = pa.invoiceBalanceNgn;
      exact++;
    } else if (debt) {
      quotedNgn = debt.amount;
      reconstructed++;
    } else {
      console.log(`  SKIP  ${pa.address}  invoice is gone, nothing to reconstruct from`);
      skipped++;
      continue;
    }

    const quotedUsdc = usdcForNgn(quotedNgn, pa.ngnPerUsd);
    if (quotedUsdc == null) {
      console.log(`  SKIP  ${pa.address}  rate ${pa.ngnPerUsd} is not usable`);
      skipped++;
      continue;
    }

    console.log(
      `  ${isExact ? "EXACT" : "RECON"}  ${pa.address}  ` +
        `${quotedUsdc} ${pa.tokenSymbol || "USDC"} ` +
        `(NGN ${Math.round(quotedNgn).toLocaleString("en-NG")} at ${pa.ngnPerUsd})` +
        (isExact ? "" : `  [current expectation: ${pa.expectedUsdc}]`)
    );

    if (APPLY) {
      pa.quote = {
        invoiceBalanceNgn: quotedNgn,
        expectedUsdc: quotedUsdc,
        ngnPerUsd: pa.ngnPerUsd,
        rateTimestamp: pa.rateTimestamp,
        rateIsFallback: Boolean(pa.rateIsFallback),
        issuedAt: pa.createdAt || pa.rateTimestamp,
        reconstructed: !isExact,
      };
      await pa.save();
    }
  }

  console.log(
    `\n${exact} exact, ${reconstructed} reconstructed, ${skipped} skipped.` +
      (reconstructed
        ? `\n\nThe ${reconstructed} reconstructed row(s) carry quote.reconstructed = true. Those ` +
          "figures are the best available guess, not a record of what the payer was told. " +
          "Do not settle a dispute on them without saying so."
        : "")
  );
  if (!APPLY) console.log("\nDry run complete. Re-run with --apply to write.");

  await mongoose.disconnect();
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch(async (err) => {
      console.error("backfill-issuance-quote failed:", err.message);
      await mongoose.disconnect().catch(() => {});
      process.exit(1);
    });
}
