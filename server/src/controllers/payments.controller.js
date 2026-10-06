const Debt = require("../models/Debt");
const Payment = require("../models/Payment");
const { recomputeDebtStatus, withDerived, paidForDebt } = require("../services/receivables.service");
const { resyncActivePaymentAddress } = require("../services/paymentAddress.service");
const { onInvoiceSettled } = require("../services/settlement.service");

async function findMyDebt(req) {
  return Debt.findOne({ _id: req.params.id, userId: req.user._id });
}

// Kept as a name local callers already use; the sum itself is the shared one
// (LW-034), so there is one definition of "paid" in the product rather than nine.
async function amountPaidFor(debtId) {
  return paidForDebt(debtId);
}

// POST /api/debts/:id/payments  { amount, method?, note?, paidAt? }
async function record(req, res) {
  try {
    const debt = await findMyDebt(req);
    if (!debt) return res.status(404).json({ error: "Debt not found" });

    const { amount, method, note, paidAt, idempotencyKey } = req.body || {};
    const amt = Number(amount);
    if (!amt || isNaN(amt) || amt <= 0) {
      return res.status(400).json({ error: "amount must be a number greater than 0" });
    }
    if (method && !["cash", "transfer", "other"].includes(method)) {
      return res.status(400).json({ error: "method must be cash, transfer or other" });
    }
    const when = paidAt ? new Date(String(paidAt)) : new Date();
    if (Number.isNaN(when.getTime())) {
      return res.status(400).json({ error: "paidAt is not a valid date" });
    }
    // A payment note is a line, not a document; it is shown on receipts and
    // statements. An object where a string was expected used to answer 500.
    const cleanNote = note == null ? undefined : String(note).trim().slice(0, 500);

    /**
     * IDEMPOTENCY FOR A MANUAL PAYMENT. REQUIRED, NOT OPTIONAL.
     *
     * The client mints one key per form and sends it with the submit. A
     * double submit, a retry after a lost response, or a second tab replaying
     * the request all carry the same key and hit the unique index on txHash,
     * so the payment is recorded once. Scoped to the user so two accounts
     * cannot collide, and prefixed so it can never look like a chain hash.
     *
     * A MISSING KEY IS NOW A 400. It used to fall through to `undefined`, and
     * the payment was then written with no key and no protection at all — which
     * is LW-016, the double-recorded payment that understates a balance and can
     * flip a small invoice to fully paid, returning silently whenever the field
     * was absent or malformed. Nothing logged it and the response looked
     * identical, so a stale cached bundle or any future bug that dropped the
     * field would have reintroduced the defect invisibly. A guard that applies
     * only when the caller volunteers it is not a guard.
     */
    if (typeof idempotencyKey !== "string" || !/^[A-Za-z0-9_-]{8,80}$/.test(idempotencyKey)) {
      return res.status(400).json({
        error:
          "This payment was sent without an idempotency key, so it was refused rather than " +
          "risk recording it twice. Reload the page and try again.",
        code: "idempotency_key_required",
      });
    }
    const key = `manual:${req.user._id}:${idempotencyKey}`;

    let payment;
    try {
      payment = await Payment.create({
        debtId: debt._id,
        userId: req.user._id,
        amount: amt,
        method: method || "transfer",
        note: cleanNote,
        paidAt: when,
        txHash: key,
      });
    } catch (err) {
      if (err && err.code === 11000) {
        const existing = await Payment.findOne({ txHash: key, userId: req.user._id });
        const totalPaidNow = await recomputeDebtStatus(debt);
        return res.status(200).json({
          payment: existing,
          debt: withDerived(debt, totalPaidNow),
          alreadyDone: true,
        });
      }
      throw err;
    }

    debt.history.push({ event: "payment_received" });
    const totalPaid = await recomputeDebtStatus(debt); // saves debt + cancels reminders at zero

    /**
     * A bank payment changes what the CRYPTO address must still ask for.
     *
     * Without this the address kept quoting the amount it was issued with, so a
     * debtor who paid half by transfer was still told to send the full token
     * amount — and the reminder, which reads this field, showed the stale figure.
     * Recomputed at the address's own snapshot rate, so the quote never moves
     * with the market.
     */
    const resync = await resyncActivePaymentAddress(debt._id);

    /**
     * ONE settlement event, both routes. Bank payments previously recorded
     * silently: no receipt to the payer, no push to the owner, while the crypto
     * route sent both. Same event, same three consequences, so they can never
     * disagree about what happened.
     */
    /**
     * THE KEY IS NOT A TRANSACTION REFERENCE, AND THE PAYER MUST NOT SEE IT.
     *
     * The receipt prints `payment.txHash` as a "Transaction:" line. That field
     * holds a real chain hash for a crypto payment and, since idempotency was
     * added, the synthetic key `manual:<userId>:<key>` for a bank one — so every
     * bank receipt mailed the customer a line containing the owner's internal
     * account id, dressed as a reference they might quote back. A bank payment
     * has no transaction hash; the honest receipt is one with no such line.
     */
    const forReceipt = { ...payment.toObject(), txHash: null };

    /**
     * THE OUTCOME IS READ, NOT DISCARDED (LW-028).
     *
     * This was `.catch(() => {})`, so a receipt that never went out — expired
     * SMTP credentials, a bouncing address, a debounce — left no trace anywhere
     * and the owner believed the customer had been receipted. The event reports
     * `{emailed, reason}` precisely so somebody can know; throwing it away made
     * the report pointless. Still non-fatal: the payment is recorded either way,
     * and a failed receipt must never fail the payment.
     */
    const settled = await onInvoiceSettled({
      debt,
      payment: forReceipt,
      method: "bank",
      creditNgn: amt,
      totalPaid,
      fullyPaid: debt.status === "paid",
    }).catch((err) => ({ emailed: false, reason: err && err.message }));

    if (settled && !settled.emailed) {
      console.warn(
        `[payments] no receipt sent for debt ${debt._id} after a manual payment: ${
          settled.reason || "unknown reason"
        }`
      );
    }

    return res.status(201).json({
      payment,
      debt: withDerived(debt, totalPaid),
      // Returned so the UI can restate the crypto amount immediately rather than
      // waiting for a refetch that might show the old figure.
      cryptoQuote: resync.updated ? resync : undefined,
    });
  } catch (err) {
    console.error("record payment error:", err.message);
    return res.status(500).json({ error: "Failed to record payment" });
  }
}

// GET /api/debts/:id/payments
async function list(req, res) {
  try {
    const debt = await findMyDebt(req);
    if (!debt) return res.status(404).json({ error: "Debt not found" });
    const payments = await Payment.find({ debtId: debt._id, userId: req.user._id }).sort({
      paidAt: -1,
    });
    return res.json({ payments });
  } catch (err) {
    console.error("list payments error:", err.message);
    return res.status(500).json({ error: "Failed to list payments" });
  }
}

// DELETE /api/debts/:id/payments/:paymentId
// Deleting a payment RAISES the balance again, so the crypto address must ask
// for more. Without the resync below it would keep quoting the lower figure and
// the invoice could never be settled in full.
async function remove(req, res) {
  try {
    const debt = await findMyDebt(req);
    if (!debt) return res.status(404).json({ error: "Debt not found" });

    const payment = await Payment.findOne({
      _id: req.params.paymentId,
      debtId: debt._id,
      userId: req.user._id,
    });
    if (!payment) return res.status(404).json({ error: "Payment not found" });

    /**
     * RELEASE THE ON-CHAIN TRANSFERS THIS PAYMENT WAS COVERING, BEFORE DELETING IT.
     *
     * A crypto Payment is the record that a set of confirmed transfers has been
     * credited. Each of those transfers carries `settledPaymentId` pointing at
     * this row. Deleting the row on its own left those stamps pointing at a
     * Payment that no longer exists, and `settleIfDue` reads them as "already
     * settled":
     *
     *     const unstamped   = confirmed.filter(o => !o.settledPaymentId)   // skips them
     *     const settledUsdc = confirmed.filter(o =>  o.settledPaymentId)   // counts them
     *     const unsettled   = totalUsdc - settledUsdc                      // 0
     *     if (unsettled <= 0) return { outcome: "NOTHING_NEW" }            // forever
     *
     * So the invoice reopened, `resyncActivePaymentAddress` re-quoted it UPWARDS,
     * and the customer was asked a second time for money that was sitting,
     * confirmed, in the derived address — which the watcher would never credit
     * again. Money already received, permanently uncreditable, and a customer
     * chased for it.
     *
     * Clearing the stamps puts those transfers back into the unsettled pool, so
     * the very next watch pass re-credits them correctly. The deletion becomes
     * what a person means by it: undo the bookkeeping, not disown the money.
     */
    const covered = [
      ...(Array.isArray(payment.txHashes) ? payment.txHashes : []),
      ...(payment.txHash ? [payment.txHash] : []),
    ].filter(Boolean);

    if (covered.length) {
      const PaymentAddress = require("../models/PaymentAddress");
      const addresses = await PaymentAddress.find({
        debtId: debt._id,
        userId: req.user._id,
        "observed.txHash": { $in: covered },
      });
      for (const pa of addresses) {
        let released = 0;
        for (const o of pa.observed) {
          // ONLY the stamps that name THIS payment. A transfer stamped by a
          // different Payment is still legitimately covered by that row, which
          // is not being deleted — releasing it would double-credit later.
          if (o.settledPaymentId && String(o.settledPaymentId) === String(payment._id)) {
            o.settledPaymentId = null;
            released++;
          }
        }
        if (released) {
          // The naira this address is recorded as having settled goes with it,
          // or the next settlement adds on top of a figure that includes the
          // credit just removed.
          pa.settledNgn = Math.max(0, (pa.settledNgn || 0) - (payment.amount || 0));
          // An address closed by this payment must be watched again. Which state
          // it returns to depends on the clock, not on how it was closed.
          if (pa.status === "paid") {
            const stillOpen = pa.expiresAt && new Date(pa.expiresAt).getTime() > Date.now();
            pa.status = stillOpen ? "active" : "expired";
            if (!stillOpen && !pa.expiredAt) pa.expiredAt = new Date();
          }
          await pa.save();
          console.warn(
            `[payments] released ${released} confirmed transfer(s) on ${pa.address} ` +
              `after payment ${payment._id} was deleted. They will be re-credited on the next watch pass.`
          );
        }
      }
    }

    await payment.deleteOne();
    const totalPaid = await recomputeDebtStatus(debt); // may revert status
    // Re-quote upward at the same snapshot rate. No notification here: nothing
    // was paid, so telling the debtor a payment "arrived" would be false.
    const resync = await resyncActivePaymentAddress(debt._id);
    return res.json({
      ok: true,
      debt: withDerived(debt, totalPaid),
      cryptoQuote: resync.updated ? resync : undefined,
    });
  } catch (err) {
    console.error("delete payment error:", err.message);
    return res.status(500).json({ error: "Failed to delete payment" });
  }
}

// GET /api/debts/:id/receipt?paymentId=  (latest payment if not specified)
async function receipt(req, res) {
  try {
    const debt = await findMyDebt(req);
    if (!debt) return res.status(404).json({ error: "Debt not found" });

    let payment;
    if (req.query.paymentId) {
      payment = await Payment.findOne({
        _id: req.query.paymentId,
        debtId: debt._id,
        userId: req.user._id,
      });
    } else {
      payment = await Payment.findOne({ debtId: debt._id, userId: req.user._id }).sort({
        paidAt: -1,
      });
    }
    if (!payment) return res.status(404).json({ error: "No payment to receipt" });

    const totalPaid = await amountPaidFor(debt._id);
    const balanceRemaining = Math.max(0, (debt.amount || 0) - totalPaid);

    return res.json({
      receipt: {
        businessName: req.user.companyName || req.user.name,
        debtorName: debt.debtorName,
        amount: payment.amount,
        method: payment.method,
        paidAt: payment.paidAt,
        currency: debt.currency || "NGN",
        balanceRemaining,
        originalAmount: debt.amount,
      },
    });
  } catch (err) {
    console.error("receipt error:", err.message);
    return res.status(500).json({ error: "Failed to build receipt" });
  }
}

module.exports = { record, list, remove, receipt };
