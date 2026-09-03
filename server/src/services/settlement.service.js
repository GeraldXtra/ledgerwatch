const Payment = require("../models/Payment");
const PaymentAddress = require("../models/PaymentAddress");
const { notifyUser } = require("./push.service");

/**
 * ONE SETTLEMENT EVENT, EVERY PAYMENT METHOD.
 *
 * Settlement, the owner's push and the payer's receipt all fire from here, for
 * BOTH crypto and bank payments. They were previously split: the crypto watcher
 * had its own version that did all three, while a bank payment recorded silently
 * — no receipt to the payer, no notification to the owner. Two implementations of
 * "a payment arrived" is two chances for them to disagree about what happened.
 *
 * NEVER THROWS. By the time this runs the money has arrived and the ledger is
 * already correct, so a failed email must not undo a successful settlement.
 */

/**
 * Debounce window. Several transfers landing seconds apart (a payer splitting an
 * amount, or a watch pass confirming a backlog) are one event to a human, so they
 * produce one email rather than a burst. Keyed by debt.
 */
const EMAIL_DEBOUNCE_MS = Number(process.env.SETTLEMENT_EMAIL_DEBOUNCE_MS || 20000);
const lastEmailAt = new Map();

function recentlyEmailed(debtId) {
  const key = String(debtId);
  const prev = lastEmailAt.get(key);
  const now = Date.now();
  if (prev && now - prev < EMAIL_DEBOUNCE_MS) return true;
  lastEmailAt.set(key, now);
  return false;
}

/**
 * What this invoice still owes, from the COMBINED total of every payment.
 *
 * This replaced an expression that read `debt.amountPaid` — a field that does not
 * exist on the Debt schema. It is attached only by `withDerived()` to plain
 * objects, so on the Mongoose document it was `undefined`, the whole thing
 * collapsed to `debt.amount - creditNgn`, and EVERY prior payment was ignored.
 * A partial receipt therefore told the debtor they owed far more than they did.
 */
async function outstandingNgnFor(debt) {
  const rows = await Payment.aggregate([
    { $match: { debtId: debt._id } },
    { $group: { _id: null, paid: { $sum: "$amount" } } },
  ]);
  const paid = rows.length ? rows[0].paid : 0;
  return Math.max(0, (debt.amount || 0) - paid);
}

/**
 * @param {object}  opts
 * @param {object}  opts.debt        Debt document (already recomputed and saved)
 * @param {object}  opts.payment     the Payment row just created
 * @param {"crypto"|"bank"} opts.method
 * @param {number}  opts.creditNgn   naira credited by THIS event
 * @param {boolean} opts.fullyPaid
 * @param {object}  [opts.pa]        PaymentAddress — crypto only
 * @param {object}  [opts.chain]     chain registry entry — crypto only
 * @param {number}  [opts.totalUsdc] tokens received — crypto only
 * @param {boolean} [opts.isLate]    crypto only
 */
async function onInvoiceSettled({
  debt,
  payment,
  method = "crypto",
  creditNgn,
  fullyPaid,
  pa = null,
  chain = null,
  totalUsdc = null,
  isLate = false,
}) {
  const remainingNgn = await outstandingNgnFor(debt);

  // The address is only re-quoted for a PARTIAL payment; on full settlement it is
  // closed by the resync helper instead.
  /**
   * ALWAYS RE-READ. NEVER TRUST THE COPY THAT WAS PASSED IN.
   *
   * The crypto watcher resyncs the address before firing this event, but
   * resync loads and saves its OWN document. The `pa` the watcher then passes
   * here is the stale in memory copy from before the resync, and `pa ||` let it
   * win. So on a 500,000 naira invoice where 200 USDC had just arrived, the
   * database said 167.65 USDC remaining and the receipt said "send 367.65": the
   * payer was asked for the full amount again, the exact sum they had just
   * paid. Reading from the database here costs one query and cannot be stale.
   */
  void pa;
  const activeAddress = fullyPaid
    ? null
    : await PaymentAddress.findOne({ debtId: debt._id, status: "active" });

  /**
   * RESOLVE THE CHAIN FROM THE ADDRESS, not only from the argument (LW-007).
   *
   * The bank route calls this with no `chain`, but `activeAddress` is still
   * found in the database above. So `payToAddress` and `stillOwedToken`
   * populated while `payToChainName` stayed null, and the receipt template
   * silently dropped the "on Base, this network only" line.
   *
   * The payer then received an address, an exact amount, and NO NETWORK. Every
   * other surface in this codebase carries an explicit wrong network warning;
   * this one path dropped it. With mainnet enabled that is the difference
   * between a payment arriving and a payment being destroyed: the same address
   * exists on every EVM chain, and funds sent on the wrong one are not
   * recoverable by anybody.
   */
  const { getChain } = require("../config/chains");
  const receiptChain =
    chain || (activeAddress && activeAddress.chainId ? getChain(activeAddress.chainId) : null);

  // ---- 1. Tell the owner --------------------------------------------------
  const received =
    method === "crypto" && totalUsdc != null && pa
      ? `${totalUsdc.toFixed(2)} ${pa.tokenSymbol} confirmed on ${chain ? chain.name : "chain"}.`
      : `${Number(creditNgn).toLocaleString("en-NG")} naira recorded.`;

  await notifyUser(
    debt.userId,
    {
      title: fullyPaid
        ? `Invoice settled — ${debt.debtorName}`
        : `Part payment received — ${debt.debtorName}`,
      body: received + (isLate ? " This arrived after the payment address had expired." : ""),
      tag: `pay-${debt._id}`,
      type: "payment",
      url: "/app/receivables",
    },
    "txUpdates"
  ).catch(() => {});

  // ---- 2. Receipt to the payer -------------------------------------------
  try {
    if (!debt.debtorEmail) return { emailed: false, reason: "no debtor email on file" };

    // eslint-disable-next-line global-require
    const { sendEmail, getLogoAttachment, isNonRoutableEmail } = require("./notify.service");
    // eslint-disable-next-line global-require
    const { buildPaymentReceiptEmail } = require("../utils/paymentReceipt");
    // eslint-disable-next-line global-require
    const User = require("../models/User");

    if (isNonRoutableEmail(debt.debtorEmail)) {
      console.warn(`[settlement] receipt not sent: ${debt.debtorEmail} would bounce.`);
      return { emailed: false, reason: "reserved domain" };
    }
    if (recentlyEmailed(debt._id)) {
      console.log(`[settlement] receipt debounced for debt ${debt._id}`);
      return { emailed: false, reason: "debounced" };
    }

    const owner = await User.findById(debt.userId).select("name bankDetails");
    const logo = getLogoAttachment();

    const { html, text } = buildPaymentReceiptEmail({
      businessName: owner && owner.name,
      debtorName: debt.debtorName,
      method,
      amountUsdc: totalUsdc,
      tokenSymbol: pa ? pa.tokenSymbol : null,
      creditNgn,
      chain,
      txHash: payment && payment.txHash ? payment.txHash : null,
      fullyPaid,
      isLate,
      // The corrected figure — combined across every method.
      remainingNgn,
      /**
       * A PARTIAL receipt repeats everything the payer needs to finish, so they
       * never have to hunt for the original email: the RECALCULATED token amount,
       * the address and the network.
       */
      stillOwedToken: activeAddress ? activeAddress.expectedUsdc : null,
      stillOwedSymbol: activeAddress ? activeAddress.tokenSymbol : null,
      payToAddress: activeAddress ? activeAddress.address : null,
      payToChainName: activeAddress && receiptChain ? receiptChain.name : null,
      hasLogo: Boolean(logo),
    });

    const res = await sendEmail(
      debt.debtorEmail,
      fullyPaid ? "Payment received in full. Thank you" : "Payment received. Thank you",
      html,
      { text, attachments: logo ? [logo] : [] }
    );
    if (!res.ok) console.error(`[settlement] receipt email failed: ${res.error}`);
    return { emailed: Boolean(res.ok), reason: res.ok ? null : res.error };
  } catch (err) {
    console.error("[settlement] receipt email error:", err.message);
    return { emailed: false, reason: err.message };
  }
}

module.exports = { onInvoiceSettled, outstandingNgnFor };
