/**
 * Back-fill `PaymentAddress.quote` for rows issued before it existed. (LW-005.)
 *
 * WHAT THIS CAN AND CANNOT RECOVER
 *
 * Until now a payment address stored ONE set of figures, and
 * `resyncActivePaymentAddress` overwrote them after every partial settlement and
 * every edit to the invoice. So for any address that has been resynced, the
 * issuance quote is gone. It was not archived anywhere; it was assigned over.
 *
 * This script therefore does two different things depending on the row, and it
 * is careful to say which:
 *
 *   NEVER RESYNCED  — the current figures ARE the issuance figures. The quote is
 *                     exact, and `reconstructed` is false.
 *   RESYNCED        — the current figures are what is still owed, not what was
 *                     asked. The best available reconstruction is the invoice's
 *                     ORIGINAL amount converted at the address's own stored
 *                     rate, which is what the quote would have been if the
 *                     address was issued before any payment landed. That is a
 *                     reasonable guess and it is NOT evidence, so
 *                     `reconstructed` is true and anything settling a dispute
 *                     must check that flag.
 *
 * Telling the two apart: an address that has settled nothing and whose
 * `invoiceBalanceNgn` still equals the invoice's full amount has not been
 * rewritten. Anything else has, or may have.
 *
 * Dry run by default. Idempotent — a row that already has `quote.issuedAt` is
 * skipped, so re-running after a partial run is safe.
 *
 *   node src/scripts/backfill-issuance-quote.js            # report only
 *   node src/scripts/backfill-issuance-quote.js --apply    # write
 */

require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const PaymentAddress = require("../models/PaymentAddress");
const Debt = require("../models/Debt");

const APPLY = process.argv.includes("--apply");

/** Two decimal places, rounded up — the same rule `usdcForNgn` uses. */
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
      // Without the rate there is nothing to reconstruct FROM. Left alone rather
      // than filled with a guess that would look like a record.
      console.log(`  SKIP  ${pa.address}  no stored rate`);
      skipped++;
      continue;
    }

    // Untouched by resync: nothing settled AND the stored balance still matches
    // the invoice's full amount.
    const settledNothing = !pa.settledNgn || pa.settledNgn === 0;
    const balanceIntact =
      debt && Math.abs((pa.invoiceBalanceNgn || 0) - (debt.amount || 0)) < 0.005;
    const isExact = settledNothing && balanceIntact;

    let quotedNgn;
    if (isExact) {
      quotedNgn = pa.invoiceBalanceNgn;
      exact++;
    } else if (debt) {
      // The invoice's ORIGINAL amount at this address's own rate. See the header.
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
        // The row's own creation time is the best issuance timestamp available.
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

/**
 * ONLY WHEN RUN DIRECTLY. A migration that runs on `require` is a migration that
 * runs whenever anything sweeps this directory — which happened once during the
 * audit that produced this script.
 */
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch(async (err) => {
      console.error("backfill-issuance-quote failed:", err.message);
      await mongoose.disconnect().catch(() => {});
      process.exit(1);
    });
}
