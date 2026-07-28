const Debt = require("../models/Debt");
const Reminder = require("../models/Reminder");
const Payment = require("../models/Payment");
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
    for (const key of editable) {
      if (req.body[key] === undefined) continue;
      if (key === "amount") debt.amount = Number(req.body.amount);
      else if (key === "dueDate") debt.dueDate = new Date(req.body.dueDate);
      else if (key === "reminderCadenceDays")
        debt.reminderCadenceDays = Number(req.body.reminderCadenceDays);
      else debt[key] = req.body[key];
    }

    debt.history.push({ event: "edited" });
    await debt.save();

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

    if (balance > 0) {
      await Payment.create({
        debtId: debt._id,
        userId: req.user._id,
        amount: balance,
        method: "other",
        note: "Marked as fully paid",
      });
    }

    const totalPaid = await recomputeDebtStatus(debt); // sets paid + cancels reminders
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
    const deliveries = await dispatchReminder(result.reminder, debt, req.user, { channels });

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
