const Debt = require("../models/Debt");
const Payment = require("../models/Payment");
const { recomputeDebtStatus, withDerived } = require("../services/receivables.service");

async function findMyDebt(req) {
  return Debt.findOne({ _id: req.params.id, userId: req.user._id });
}

async function amountPaidFor(debtId) {
  const rows = await Payment.aggregate([
    { $match: { debtId } },
    { $group: { _id: null, paid: { $sum: "$amount" } } },
  ]);
  return rows.length ? rows[0].paid : 0;
}

// POST /api/debts/:id/payments  { amount, method?, note?, paidAt? }
async function record(req, res) {
  try {
    const debt = await findMyDebt(req);
    if (!debt) return res.status(404).json({ error: "Debt not found" });

    const { amount, method, note, paidAt } = req.body || {};
    const amt = Number(amount);
    if (!amt || isNaN(amt) || amt <= 0) {
      return res.status(400).json({ error: "amount must be a number greater than 0" });
    }
    if (method && !["cash", "transfer", "other"].includes(method)) {
      return res.status(400).json({ error: "method must be cash, transfer or other" });
    }

    const payment = await Payment.create({
      debtId: debt._id,
      userId: req.user._id,
      amount: amt,
      method: method || "transfer",
      note,
      paidAt: paidAt ? new Date(paidAt) : new Date(),
    });

    debt.history.push({ event: "payment_received" });
    const totalPaid = await recomputeDebtStatus(debt); // saves debt + cancels reminders at zero

    return res.status(201).json({ payment, debt: withDerived(debt, totalPaid) });
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

    await payment.deleteOne();
    const totalPaid = await recomputeDebtStatus(debt); // may revert status
    return res.json({ ok: true, debt: withDerived(debt, totalPaid) });
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
        businessName: req.user.name,
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
