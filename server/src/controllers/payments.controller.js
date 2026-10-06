const Debt = require("../models/Debt");
const Payment = require("../models/Payment");
const { recomputeDebtStatus, withDerived, paidForDebt } = require("../services/receivables.service");
const { resyncActivePaymentAddress } = require("../services/paymentAddress.service");
const { onInvoiceSettled } = require("../services/settlement.service");

async function findMyDebt(req) {
  return Debt.findOne({ _id: req.params.id, userId: req.user._id });
}

async function amountPaidFor(debtId) {
  return paidForDebt(debtId);
}

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
    const cleanNote = note == null ? undefined : String(note).trim().slice(0, 500);

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
    const totalPaid = await recomputeDebtStatus(debt);

    const resync = await resyncActivePaymentAddress(debt._id);

    const forReceipt = { ...payment.toObject(), txHash: null };

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
      cryptoQuote: resync.updated ? resync : undefined,
    });
  } catch (err) {
    console.error("record payment error:", err.message);
    return res.status(500).json({ error: "Failed to record payment" });
  }
}

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
          if (o.settledPaymentId && String(o.settledPaymentId) === String(payment._id)) {
            o.settledPaymentId = null;
            released++;
          }
        }
        if (released) {
          pa.settledNgn = Math.max(0, (pa.settledNgn || 0) - (payment.amount || 0));
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
    const totalPaid = await recomputeDebtStatus(debt);
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
