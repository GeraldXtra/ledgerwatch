const Debt = require("../models/Debt");
const Reminder = require("../models/Reminder");
const Payment = require("../models/Payment");
const PaymentAddress = require("../models/PaymentAddress");
const { normalizePhone } = require("../utils/phone");
const {
  generateReminderForDebt,
  dispatchReminder,
} = require("../services/reminder.service");
const { attachTotals, withDerived, recomputeDebtStatus, paidForDebt } = require("../services/receivables.service");
const { resyncActivePaymentAddress } = require("../services/paymentAddress.service");
const { onInvoiceSettled } = require("../services/settlement.service");

const { isPlainAddress } = require("../utils/email");

const TEXT_LIMITS = { debtorName: 120, debtorPhone: 40, debtorEmail: 254, note: 2000 };

function cleanText(body) {
  for (const [key, max] of Object.entries(TEXT_LIMITS)) {
    if (body[key] === undefined || body[key] === null) continue;
    body[key] = String(body[key]).trim().slice(0, max);
  }
  return body;
}

function validateDebtFields(body, { partial = false } = {}) {
  const errors = [];
  cleanText(body);

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
    if (!isPlainAddress(String(body.debtorEmail))) {
      errors.push("debtorEmail is not a valid email address");
    }
  }
  if (has("reminderCadenceDays")) {
    const c = Number(body.reminderCadenceDays);
    if (isNaN(c) || c < 1) errors.push("reminderCadenceDays must be >= 1");
  }

  return errors;
}

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

async function list(req, res) {
  try {
    const filter = { userId: req.user._id };
    const { status, sort, search, from, to } = req.query;

    if (["pending", "partially_paid", "paid"].includes(status)) {
      filter.status = status;
    }
    const term = String(search || "").trim().slice(0, 100);
    if (term) {
      const rx = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [{ debtorName: rx }, { debtorPhone: rx }];
    }
    if (from || to) {
      const fromDate = from ? new Date(String(from)) : null;
      const toDate = to ? new Date(String(to)) : null;
      if ((fromDate && Number.isNaN(fromDate.getTime())) || (toDate && Number.isNaN(toDate.getTime()))) {
        return res.status(400).json({ error: "from and to must be valid dates" });
      }
      filter.dueDate = {};
      if (fromDate) filter.dueDate.$gte = fromDate;
      if (toDate) filter.dueDate.$lte = toDate;
    }

    const raw = await Debt.find(filter).sort({ createdAt: -1 });
    let debts = await attachTotals(req.user._id, raw);

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

async function getOne(req, res) {
  try {
    const debt = await Debt.findOne({ _id: req.params.id, userId: req.user._id });
    if (!debt) return res.status(404).json({ error: "Debt not found" });
    const [withPaid] = await attachTotals(req.user._id, [debt]);
    return res.json({ debt: withPaid });
  } catch (err) {
    if (err && err.name === "CastError") {
      return res.status(404).json({ error: "Debt not found" });
    }
    console.error("getOne debt error:", err.message);
    return res.status(500).json({ error: "Could not load that invoice just now." });
  }
}

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

    if (amountChanged) {
      const paid = await paidForDebt(debt._id);
      if (Number(debt.amount) < paid) {
        return res.status(400).json({
          error: `The amount cannot be lower than the ${paid.toLocaleString("en-NG")} already recorded as paid on this invoice.`,
        });
      }
    }

    debt.history.push({ event: "edited" });
    await debt.save();

    if (amountChanged) {
      const totalPaid = await recomputeDebtStatus(debt);
      await resyncActivePaymentAddress(debt._id);
      return res.json({ debt: withDerived(debt, totalPaid) });
    }

    return res.json({ debt });
  } catch (err) {
    console.error("update debt error:", err.message);
    return res.status(500).json({ error: "Failed to update debt" });
  }
}

async function remove(req, res) {
  try {
    const debt = await Debt.findOne({ _id: req.params.id, userId: req.user._id });
    if (!debt) return res.status(404).json({ error: "Debt not found" });

    const addressesHeld = await PaymentAddress.find({
      debtId: debt._id,
      userId: req.user._id,
    }).lean();

    const holding = addressesHeld.filter((pa) => {
      const seen = (pa.observed || [])
        .filter((o) => o.status === "confirmed")
        .reduce((sum, o) => sum + Number(o.value || 0) / 10 ** (pa.tokenDecimals || 6), 0);
      const swept = (pa.sweeps || []).reduce((sum, x) => sum + (Number(x.amountUsdc) || 0), 0);
      return seen - swept > 1 / 10 ** (pa.tokenDecimals || 6);
    });

    const force = String(req.query.force || "").toLowerCase() === "true";
    if (holding.length && !force) {
      return res.status(409).json({
        error:
          "This invoice has a payment address that is still holding money. Sweep it first, " +
          "or the record of which address it is will be gone.",
        code: "unswept_funds",
        addresses: holding.map((pa) => ({
          address: pa.address,
          chainId: pa.chainId,
          tokenSymbol: pa.tokenSymbol,
          derivationIndex: pa.derivationIndex,
        })),
      });
    }

    if (holding.length && force) {
      console.warn(
        `[debts] invoice ${debt._id} deleted with unswept funds, forced by the owner. ` +
          holding
            .map((pa) => `${pa.address} (chain ${pa.chainId}, index ${pa.derivationIndex})`)
            .join("; ")
      );
    }

    await Reminder.deleteMany({ debtId: debt._id, userId: req.user._id });
    await Payment.deleteMany({ debtId: debt._id, userId: req.user._id });
    await PaymentAddress.deleteMany({ debtId: debt._id, userId: req.user._id });
    await debt.deleteOne();

    return res.json({ ok: true });
  } catch (err) {
    console.error("delete debt error:", err.message);
    return res.status(500).json({ error: "Failed to delete debt" });
  }
}

async function markPaid(req, res) {
  try {
    const debt = await Debt.findOne({ _id: req.params.id, userId: req.user._id });
    if (!debt) return res.status(404).json({ error: "Debt not found" });

    const paidSoFar = await paidForDebt(debt._id);
    const balance = (debt.amount || 0) - paidSoFar;

    let payment = null;
    if (balance > 0) {
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

    const totalPaid = await recomputeDebtStatus(debt);
    await resyncActivePaymentAddress(debt._id);

    if (payment) {
      const forReceipt = { ...payment.toObject(), txHash: null };

      const settled = await onInvoiceSettled({
        debt,
        payment: forReceipt,
        method: "bank",
        creditNgn: balance,
        totalPaid,
        fullyPaid: true,
      }).catch((err) => ({ emailed: false, reason: err && err.message }));

      if (settled && !settled.emailed) {
        console.warn(
          `[debts] no receipt sent for debt ${debt._id} after it was marked paid: ${
            settled.reason || "unknown reason"
          }`
        );
      }
    }

    return res.json({ debt: withDerived(debt, totalPaid) });
  } catch (err) {
    console.error("markPaid error:", err.message);
    return res.status(500).json({ error: "Failed to mark debt as paid" });
  }
}

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

async function remind(req, res) {
  try {
    const debt = await Debt.findOne({ _id: req.params.id, userId: req.user._id });
    if (!debt) return res.status(404).json({ error: "Debt not found" });

    const result = await generateReminderForDebt(debt, req.user);
    return res.status(201).json(result);
  } catch (err) {
    if (err && err.status) return res.status(err.status).json({ error: err.message });
    console.error("remind error:", err.message);
    return res.status(500).json({ error: "Failed to generate reminder" });
  }
}

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
    const deliveries = await dispatchReminder(result.reminder, debt, req.user, {
      channels,
      force: true,
    });

    return res.status(201).json({ ...result, deliveries });
  } catch (err) {
    if (err && err.status) return res.status(err.status).json({ error: err.message });
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
