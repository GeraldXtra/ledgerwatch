const Debt = require("../models/Debt");
const Reminder = require("../models/Reminder");
const Payment = require("../models/Payment");
const PaymentAddress = require("../models/PaymentAddress");
const { normalizePhone } = require("../utils/phone");
const {
  generateReminderForDebt,
  dispatchReminder,
} = require("../services/reminder.service");
const {
  attachTotals,
  withDerived,
  recomputeDebtStatus,
} = require("../services/receivables.service");
const { resyncActivePaymentAddress } = require("../services/paymentAddress.service");
const { onInvoiceSettled } = require("../services/settlement.service");

// ---- validation helpers ---------------------------------------------------

function validateDebtFields(body, { partial = false } = {}) {
  const errors = [];

  const has = (k) => body[k] !== undefined && body[k] !== null && body[k] !== "";

  if (!partial || has("debtorName")) {
    if (!has("debtorName")) errors.push("debtorName is required");
  }
  if (!partial || has("amount")) {
    const amt = Number(body.amount);
    if (!has("amount") || isNaN(amt) || amt <= 0) {
      errors.push("amount must be a number greater than 0");
    }
  }
  if (!partial || has("dueDate")) {
    const d = new Date(body.dueDate);
    if (!has("dueDate") || isNaN(d.getTime())) {
      errors.push("dueDate is required and must be a valid date");
    }
  }
  if (has("debtorPhone")) {
    if (!normalizePhone(body.debtorPhone).valid) {
      errors.push("debtorPhone does not look like a usable phone number");
    }
  }
  if (has("debtorEmail")) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(body.debtorEmail).trim())) {
      errors.push("debtorEmail is not a valid email address");
    }
  }
  if (has("reminderCadenceDays")) {
    const c = Number(body.reminderCadenceDays);
    if (isNaN(c) || c < 1) errors.push("reminderCadenceDays must be >= 1");
  }

  return errors;
}

// ---- controllers ----------------------------------------------------------

// POST /api/debts
async function create(req, res) {
  try {
    const errors = validateDebtFields(req.body || {});
    if (errors.length) return res.status(400).json({ error: errors.join("; ") });

    const { debtorName, debtorPhone, debtorEmail, amount, dueDate, note, reminderCadenceDays } =
      req.body;

    const debt = await Debt.create({
      userId: req.user._id,
      debtorName,
      debtorPhone,
      debtorEmail,
      amount: Number(amount),
      dueDate: new Date(dueDate),
      note,
      ...(reminderCadenceDays !== undefined
        ? { reminderCadenceDays: Number(reminderCadenceDays) }
        : {}),
      history: [{ event: "created" }],
    });

    return res.status(201).json({ debt });
  } catch (err) {
    console.error("create debt error:", err.message);
    return res.status(500).json({ error: "Failed to create debt" });
  }
}

// GET /api/debts?status=&sort=&search=&from=&to=
// Debts come back with derived amountPaid / balance / displayStatus.
async function list(req, res) {
  try {
    const filter = { userId: req.user._id };
    const { status, sort, search, from, to } = req.query;

    if (["pending", "partially_paid", "paid"].includes(status)) {
      filter.status = status;
    }
    if (search && search.trim()) {
      const rx = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [{ debtorName: rx }, { debtorPhone: rx }];
    }
    if (from || to) {
      filter.dueDate = {};
      if (from) filter.dueDate.$gte = new Date(from);
      if (to) filter.dueDate.$lte = new Date(to);
    }

    const raw = await Debt.find(filter).sort({ createdAt: -1 });
    let debts = await attachTotals(req.user._id, raw);

    // Sort in JS so balance/status (derived) are sortable too.
    const dir = 1;
    const cmp = {
      amount: (a, b) => b.amount - a.amount,
      balance: (a, b) => b.balance - a.balance,
      due: (a, b) => new Date(a.dueDate) - new Date(b.dueDate),
      overdue: (a, b) => new Date(a.dueDate) - new Date(b.dueDate),
      debtor: (a, b) => (a.debtorName || "").localeCompare(b.debtorName || ""),
      status: (a, b) => (a.displayStatus || "").localeCompare(b.displayStatus || ""),
    }[sort];
    if (cmp) debts = debts.sort((a, b) => cmp(a, b) * dir);

    return res.json({ debts });
  } catch (err) {
    console.error("list debts error:", err.message);
    return res.status(500).json({ error: "Failed to list debts" });
  }
}

// GET /api/debts/:id
async function getOne(req, res) {
  try {
    const debt = await Debt.findOne({ _id: req.params.id, userId: req.user._id });
    if (!debt) return res.status(404).json({ error: "Debt not found" });
    const [withPaid] = await attachTotals(req.user._id, [debt]);
    return res.json({ debt: withPaid });
  } catch (err) {
    return res.status(404).json({ error: "Debt not found" });
  }
}

// PATCH /api/debts/:id
async function update(req, res) {
  try {
    const errors = validateDebtFields(req.body || {}, { partial: true });
    if (errors.length) return res.status(400).json({ error: errors.join("; ") });

    const debt = await Debt.findOne({ _id: req.params.id, userId: req.user._id });
    if (!debt) return res.status(404).json({ error: "Debt not found" });

    const editable = [
      "debtorName",
      "debtorPhone",
      "debtorEmail",
      "amount",
      "dueDate",
      "note",
      "reminderCadenceDays",
    ];
    const amountBefore = Number(debt.amount) || 0;
    for (const key of editable) {
      if (req.body[key] === undefined) continue;
      if (key === "amount") debt.amount = Number(req.body.amount);
      else if (key === "dueDate") debt.dueDate = new Date(req.body.dueDate);
      else if (key === "reminderCadenceDays")
        debt.reminderCadenceDays = Number(req.body.reminderCadenceDays);
      else debt[key] = req.body[key];
    }
    const amountChanged = Number(debt.amount) !== amountBefore;

    /**
     * LW-017. Every other path that changes what an invoice owes calls
     * `resyncActivePaymentAddress`; this one did not. So the crypto address
     * kept the quote it was issued with: raise a 100,000 naira invoice to
     * 10,000,000 and the address still asked for 62.50 USDC, and a payer who
     * sent exactly that settled the whole thing. The reminder and the QR both
     * read that stale figure. Recompute and resync whenever the amount moves.
     *
     * An amount below what has already been paid is refused rather than
     * silently producing a negative balance and a "paid" status that no
     * payment justified.
     */
    if (amountChanged) {
      const agg = await Payment.aggregate([
        { $match: { debtId: debt._id } },
        { $group: { _id: null, paid: { $sum: "$amount" } } },
      ]);
      const paid = agg.length ? agg[0].paid : 0;
      if (Number(debt.amount) < paid) {
        return res.status(400).json({
          error: `The amount cannot be lower than the ${paid.toLocaleString("en-NG")} already recorded as paid on this invoice.`,
        });
      }
    }

    debt.history.push({ event: "edited" });
    await debt.save();

    if (amountChanged) {
      const totalPaid = await recomputeDebtStatus(debt); // status may flip either way
      await resyncActivePaymentAddress(debt._id); // the crypto quote follows the new balance
      return res.json({ debt: withDerived(debt, totalPaid) });
    }

    return res.json({ debt });
  } catch (err) {
    console.error("update debt error:", err.message);
    return res.status(500).json({ error: "Failed to update debt" });
  }
}

// DELETE /api/debts/:id  (also deletes its reminders)
async function remove(req, res) {
  try {
    const debt = await Debt.findOne({ _id: req.params.id, userId: req.user._id });
    if (!debt) return res.status(404).json({ error: "Debt not found" });

    await Reminder.deleteMany({ debtId: debt._id, userId: req.user._id });
    await Payment.deleteMany({ debtId: debt._id, userId: req.user._id });
    // Payment addresses belong to the invoice. Left behind, the watch pass keeps
    // scanning them for an invoice that no longer exists and could never settle.
    await PaymentAddress.deleteMany({ debtId: debt._id, userId: req.user._id });
    await debt.deleteOne();

    return res.json({ ok: true });
  } catch (err) {
    console.error("delete debt error:", err.message);
    return res.status(500).json({ error: "Failed to delete debt" });
  }
}

// PATCH /api/debts/:id/paid  (settle in full: records a payment for the remaining
// balance so totals/analytics stay coherent, then marks paid + cancels reminders)
async function markPaid(req, res) {
  try {
    const debt = await Debt.findOne({ _id: req.params.id, userId: req.user._id });
    if (!debt) return res.status(404).json({ error: "Debt not found" });

    const agg = await Payment.aggregate([
      { $match: { debtId: debt._id } },
      { $group: { _id: null, paid: { $sum: "$amount" } } },
    ]);
    const paidSoFar = agg.length ? agg[0].paid : 0;
    const balance = (debt.amount || 0) - paidSoFar;

    let payment = null;
    if (balance > 0) {
      /**
       * IDEMPOTENT, AT THE DATABASE.
       *
       * Two of these requests at once, a double tap on a phone or a retry
       * after a timeout, both read the same `paidSoFar`, both computed the same
       * balance, and both inserted: a 500,000 naira invoice credited a million.
       * Manual payments carry no transaction hash, so the unique index on
       * txHash never protected them.
       *
       * A deterministic key in that same field does. It is built from the debt
       * and the balance at the moment of marking, so two concurrent attempts
       * collide and the second is told the first already did it, while a
       * legitimate later mark after the balance has changed gets a new key.
       */
      const key = `markpaid:${debt._id}:${Math.round(paidSoFar * 100)}`;
      try {
        payment = await Payment.create({
          debtId: debt._id,
          userId: req.user._id,
          amount: balance,
          method: "other",
          note: "Marked as fully paid",
          txHash: key,
        });
      } catch (err) {
        if (err && err.code === 11000) {
          const totalPaidNow = await recomputeDebtStatus(debt);
          return res.status(200).json({ debt: withDerived(debt, totalPaidNow), alreadyDone: true });
        }
        throw err;
      }
    }

    const totalPaid = await recomputeDebtStatus(debt); // sets paid + cancels reminders
    // Force-settling closes any active crypto address, so it stops quoting an
    // amount for an invoice that is already paid.
    await resyncActivePaymentAddress(debt._id);

    /**
     * THE SAME EVENT THE OTHER TWO WRITERS FIRE. This was the third writer of
     * Payment and the only one that fired nothing (LW-015), so force settling
     * an invoice sent no receipt and no push. One event, three consequences,
     * from every path that closes an invoice.
     */
    if (payment) {
      await onInvoiceSettled({
        debt,
        payment,
        method: "bank",
        creditNgn: balance,
        totalPaid,
        fullyPaid: true,
      }).catch(() => {});
    }

    return res.json({ debt: withDerived(debt, totalPaid) });
  } catch (err) {
    console.error("markPaid error:", err.message);
    return res.status(500).json({ error: "Failed to mark debt as paid" });
  }
}

// GET /api/debts/:id/reminders
async function listReminders(req, res) {
  try {
    const debt = await Debt.findOne({ _id: req.params.id, userId: req.user._id });
    if (!debt) return res.status(404).json({ error: "Debt not found" });

    const reminders = await Reminder.find({
      debtId: debt._id,
      userId: req.user._id,
    }).sort({ createdAt: -1 });

    return res.json({ reminders });
  } catch (err) {
    console.error("listReminders error:", err.message);
    return res.status(500).json({ error: "Failed to list reminders" });
  }
}

// POST /api/debts/:id/remind  (generate a reminder now, on demand)
async function remind(req, res) {
  try {
    const debt = await Debt.findOne({ _id: req.params.id, userId: req.user._id });
    if (!debt) return res.status(404).json({ error: "Debt not found" });

    // Shared reminder engine — identical to the automation pass.
    const result = await generateReminderForDebt(debt, req.user);
    return res.status(201).json(result);
  } catch (err) {
    console.error("remind error:", err.message);
    return res.status(500).json({ error: "Failed to generate reminder" });
  }
}

// POST /api/debts/:id/send  { channels: ["whatsapp","email"] }
// Generates a reminder and dispatches it over the requested channels, recording a
// per-channel delivery. Degrades gracefully when a provider is not configured.
async function send(req, res) {
  try {
    const debt = await Debt.findOne({ _id: req.params.id, userId: req.user._id });
    if (!debt) return res.status(404).json({ error: "Debt not found" });

    const requested = Array.isArray(req.body && req.body.channels) ? req.body.channels : [];
    const channels = requested.filter((c) => ["whatsapp", "email"].includes(c));
    if (channels.length === 0) {
      return res.status(400).json({ error: "channels must include 'whatsapp' and/or 'email'" });
    }
    if (channels.includes("email") && !debt.debtorEmail) {
      return res.status(400).json({ error: "This debtor has no email on file" });
    }

    const result = await generateReminderForDebt(debt, req.user);
    /**
     * force: a PERSON pressed send on this exact debt.
     *
     * The cadence guard exists to stop the automation emailing a client every
     * time the loop runs. It should never override a deliberate human action:
     * without this, a second manual send inside the cadence window came back
     * "skipped: already sent this cadence window" and looked like email was
     * broken, which is precisely how it was misread.
     */
    const deliveries = await dispatchReminder(result.reminder, debt, req.user, {
      channels,
      force: true,
    });

    return res.status(201).json({ ...result, deliveries });
  } catch (err) {
    console.error("send reminder error:", err.message);
    return res.status(500).json({ error: "Failed to send reminder" });
  }
}

module.exports = {
  create,
  list,
  getOne,
  update,
  remove,
  markPaid,
  listReminders,
  remind,
  send,
};
