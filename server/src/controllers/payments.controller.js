const { scopedRepo } = require("../repositories/scoped");
const { recomputeDebtStatus, withDerived, paidKoboForDebt } = require("../services/receivables.service");
const { resyncActivePaymentAddress } = require("../services/paymentAddress.service");
const { onInvoiceSettled } = require("../services/settlement.service");
const { nairaToKobo, koboToNaira, koboOf, hasWholeKobo, MAX_NAIRA } = require("../domain/money");

async function record(req, res) {
  try {
    const repo = scopedRepo(req.user._id);
    const debt = await repo.debts.findById(req.params.id);
    if (!debt) return res.status(404).json({ error: "Debt not found" });

    const { amount, method, note, paidAt, idempotencyKey } = req.body;
    const amt = Number(amount);
    if (!amt || isNaN(amt) || amt <= 0) {
      return res.status(400).json({ error: "amount must be a number greater than 0" });
    }
    if (amt > MAX_NAIRA) {
      return res.status(400).json({ error: "amount can be at most 1,000,000,000,000" });
    }
    if (!hasWholeKobo(amt)) {
      return res.status(400).json({ error: "amount can have at most two decimal places" });
    }
    const when = paidAt ? new Date(paidAt) : new Date();
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
    const amountKobo = nairaToKobo(amt);

    let payment;
    try {
      payment = await repo.payments.create({
        debtId: debt._id,
        amount: koboToNaira(amountKobo),
        amountKobo,
        method: method || "transfer",
        note: cleanNote,
        paidAt: when,
        txHash: key,
      });
    } catch (err) {
      if (err && err.code === 11000) {
        const existing = await repo.payments.findOne({ txHash: key });
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
      creditNgn: koboToNaira(amountKobo),
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
    const repo = scopedRepo(req.user._id);
    const debt = await repo.debts.findById(req.params.id);
    if (!debt) return res.status(404).json({ error: "Debt not found" });
    const payments = await repo.payments.find({ debtId: debt._id }).sort({ paidAt: -1 });
    return res.json({ payments });
  } catch (err) {
    console.error("list payments error:", err.message);
    return res.status(500).json({ error: "Failed to list payments" });
  }
}

async function remove(req, res) {
  try {
    const repo = scopedRepo(req.user._id);
    const debt = await repo.debts.findById(req.params.id);
    if (!debt) return res.status(404).json({ error: "Debt not found" });

    const payment = await repo.payments.findOne({ _id: req.params.paymentId, debtId: debt._id });
    if (!payment) return res.status(404).json({ error: "Payment not found" });

    const covered = [
      ...(Array.isArray(payment.txHashes) ? payment.txHashes : []),
      ...(payment.txHash ? [payment.txHash] : []),
    ].filter(Boolean);

    if (covered.length) {
      const addresses = await repo.paymentAddresses.find({
        debtId: debt._id,
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
          const settledKobo = Number.isSafeInteger(pa.settledKobo) ? pa.settledKobo : nairaToKobo(pa.settledNgn || 0);
          pa.settledKobo = Math.max(0, settledKobo - koboOf(payment));
          pa.settledNgn = koboToNaira(pa.settledKobo);
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
    const repo = scopedRepo(req.user._id);
    const debt = await repo.debts.findById(req.params.id);
    if (!debt) return res.status(404).json({ error: "Debt not found" });

    const payment = req.query.paymentId
      ? await repo.payments.findOne({ _id: req.query.paymentId, debtId: debt._id })
      : await repo.payments.findOne({ debtId: debt._id }).sort({ paidAt: -1 });
    if (!payment) return res.status(404).json({ error: "No payment to receipt" });

    const paidKobo = await paidKoboForDebt(debt._id);
    const owedKobo = koboOf(debt);

    return res.json({
      receipt: {
        businessName: req.user.companyName || req.user.name,
        debtorName: debt.debtorName,
        invoiceNumber: debt.invoiceNumber || null,
        amount: koboToNaira(koboOf(payment)),
        method: payment.method,
        paidAt: payment.paidAt,
        currency: debt.currency || "NGN",
        balanceRemaining: koboToNaira(Math.max(0, owedKobo - paidKobo)),
        originalAmount: koboToNaira(owedKobo),
      },
    });
  } catch (err) {
    console.error("receipt error:", err.message);
    return res.status(500).json({ error: "Failed to build receipt" });
  }
}

module.exports = { record, list, remove, receipt };
