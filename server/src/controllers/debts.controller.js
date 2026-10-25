const { scopedRepo } = require("../repositories/scoped");
const { normalizePhone } = require("../utils/phone");
const {
  generateReminderForDebt,
  dispatchReminder,
} = require("../services/reminder.service");
const {
  attachTotals,
  withDerived,
  recomputeDebtStatus,
  paidKoboForDebt,
} = require("../services/receivables.service");
const { resyncActivePaymentAddress } = require("../services/paymentAddress.service");
const { onInvoiceSettled } = require("../services/settlement.service");
const {
  nextInvoiceNumber,
  ensureInvoiceNumber,
  ensurePublicToken,
  rotatePublicToken,
  payPageUrl,
  invoiceView,
  buildInvoicePdf,
  invoiceFileName,
} = require("../services/invoice.service");
const { nairaToKobo, koboToNaira, koboOf, hasWholeKobo, MAX_NAIRA } = require("../domain/money");
const { confirmedUnsweptUnits } = require("../services/paymentWatch.service");

const { isPlainAddress } = require("../utils/email");

const TEXT_LIMITS = { debtorName: 120, debtorPhone: 40, debtorEmail: 254, note: 2000 };

function cleanText(body) {
  for (const [key, max] of Object.entries(TEXT_LIMITS)) {
    if (body[key] === undefined || body[key] === null) continue;
    body[key] = String(body[key]).trim().slice(0, max);
  }
  return body;
}

function has(body, key) {
  return body[key] !== undefined && body[key] !== null && body[key] !== "";
}

function validateDebtFields(body, { partial = false } = {}) {
  const errors = [];
  cleanText(body);

  if (!partial || has(body, "debtorName")) {
    if (!has(body, "debtorName")) errors.push("debtorName is required");
  }
  if (!partial || has(body, "amount")) {
    const amt = Number(body.amount);
    if (!has(body, "amount") || isNaN(amt) || amt <= 0) {
      errors.push("amount must be a number greater than 0");
    } else if (amt > MAX_NAIRA) {
      errors.push("amount can be at most 1,000,000,000,000");
    } else if (!hasWholeKobo(amt)) {
      errors.push("amount can have at most two decimal places");
    }
  }
  if (!partial || has(body, "dueDate")) {
    const d = new Date(body.dueDate);
    if (!has(body, "dueDate") || isNaN(d.getTime())) {
      errors.push("dueDate is required and must be a valid date");
    }
  }
  if (has(body, "debtorPhone")) {
    if (!normalizePhone(body.debtorPhone).valid) {
      errors.push("debtorPhone does not look like a usable phone number");
    }
  }
  if (has(body, "debtorEmail")) {
    if (!isPlainAddress(String(body.debtorEmail))) {
      errors.push("debtorEmail is not a valid email address");
    }
  }
  if (has(body, "reminderCadenceDays")) {
    const c = Number(body.reminderCadenceDays);
    if (!Number.isInteger(c) || c < 1) errors.push("reminderCadenceDays must be a whole number of at least 1");
  }

  return errors;
}

async function create(req, res) {
  try {
    const body = req.body;
    const errors = validateDebtFields(body);
    if (errors.length) return res.status(400).json({ error: errors.join("; ") });

    const amountKobo = nairaToKobo(body.amount);
    const invoiceNumber = await nextInvoiceNumber(req.user._id);
    const debt = await scopedRepo(req.user._id).debts.create({
      invoiceNumber,
      debtorName: body.debtorName,
      debtorPhone: body.debtorPhone,
      debtorEmail: body.debtorEmail,
      amount: koboToNaira(amountKobo),
      amountKobo,
      dueDate: new Date(body.dueDate),
      note: body.note,
      ...(has(body, "reminderCadenceDays") ? { reminderCadenceDays: Number(body.reminderCadenceDays) } : {}),
      history: [{ event: "created" }],
    });

    return res.status(201).json({ debt });
  } catch (err) {
    console.error("create debt error:", err.message);
    return res.status(500).json({ error: "Failed to create debt" });
  }
}

const SORTS = {
  amount: (a, b) => b.amountKobo - a.amountKobo,
  balance: (a, b) => b.balanceKobo - a.balanceKobo,
  due: (a, b) => new Date(a.dueDate) - new Date(b.dueDate),
  overdue: (a, b) => new Date(a.dueDate) - new Date(b.dueDate),
  debtor: (a, b) => (a.debtorName || "").localeCompare(b.debtorName || ""),
  status: (a, b) => (a.displayStatus || "").localeCompare(b.displayStatus || ""),
};

async function list(req, res) {
  try {
    const filter = {};
    const { status, sort, search, from, to } = req.query;

    if (status) filter.status = status;
    const term = String(search || "").trim().slice(0, 100);
    if (term) {
      const rx = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [{ debtorName: rx }, { debtorPhone: rx }];
    }
    if (from || to) {
      filter.dueDate = {};
      if (from) filter.dueDate.$gte = new Date(from);
      if (to) filter.dueDate.$lte = new Date(to);
    }

    const raw = await scopedRepo(req.user._id).debts.find(filter).sort({ createdAt: -1 });
    let debts = await attachTotals(req.user._id, raw);

    const cmp = SORTS[sort];
    if (cmp) debts = debts.sort(cmp);

    return res.json({ debts });
  } catch (err) {
    console.error("list debts error:", err.message);
    return res.status(500).json({ error: "Failed to list debts" });
  }
}

async function getOne(req, res) {
  try {
    const debt = await scopedRepo(req.user._id).debts.findById(req.params.id);
    if (!debt) return res.status(404).json({ error: "Debt not found" });
    const [withPaid] = await attachTotals(req.user._id, [debt]);
    return res.json({ debt: withPaid });
  } catch (err) {
    console.error("getOne debt error:", err.message);
    return res.status(500).json({ error: "Could not load that invoice just now." });
  }
}

const EDITABLE = ["debtorName", "debtorPhone", "debtorEmail", "amount", "dueDate", "note", "reminderCadenceDays"];

async function update(req, res) {
  try {
    const body = req.body;
    const errors = validateDebtFields(body, { partial: true });
    if (errors.length) return res.status(400).json({ error: errors.join("; ") });

    const debt = await scopedRepo(req.user._id).debts.findById(req.params.id);
    if (!debt) return res.status(404).json({ error: "Debt not found" });

    const amountKoboBefore = koboOf(debt);
    for (const key of EDITABLE) {
      if (body[key] === undefined) continue;
      if (key === "amount") {
        if (!has(body, "amount")) continue;
        debt.amountKobo = nairaToKobo(body.amount);
        debt.amount = koboToNaira(debt.amountKobo);
      } else if (key === "dueDate") {
        if (has(body, "dueDate")) debt.dueDate = new Date(body.dueDate);
      } else if (key === "reminderCadenceDays") {
        if (has(body, "reminderCadenceDays")) debt.reminderCadenceDays = Number(body.reminderCadenceDays);
      } else if (key === "debtorName") {
        if (has(body, "debtorName")) debt.debtorName = body.debtorName;
      } else {
        debt[key] = body[key];
      }
    }
    const amountChanged = koboOf(debt) !== amountKoboBefore;

    if (amountChanged) {
      const paidKobo = await paidKoboForDebt(debt._id);
      if (koboOf(debt) < paidKobo) {
        return res.status(400).json({
          error: `The amount cannot be lower than the ${koboToNaira(paidKobo).toLocaleString("en-NG")} already recorded as paid on this invoice.`,
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
    const repo = scopedRepo(req.user._id);
    const debt = await repo.debts.findById(req.params.id);
    if (!debt) return res.status(404).json({ error: "Debt not found" });

    const addressesHeld = await repo.paymentAddresses.find({ debtId: debt._id }).lean();
    const holding = addressesHeld.filter((pa) => confirmedUnsweptUnits(pa) > 1n);

    const force = req.query.force === "true";
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

    await repo.reminders.deleteMany({ debtId: debt._id });
    await repo.payments.deleteMany({ debtId: debt._id });
    await repo.paymentAddresses.deleteMany({ debtId: debt._id });
    await debt.deleteOne();

    return res.json({ ok: true });
  } catch (err) {
    console.error("delete debt error:", err.message);
    return res.status(500).json({ error: "Failed to delete debt" });
  }
}

async function markPaid(req, res) {
  try {
    const repo = scopedRepo(req.user._id);
    const debt = await repo.debts.findById(req.params.id);
    if (!debt) return res.status(404).json({ error: "Debt not found" });

    const paidSoFarKobo = await paidKoboForDebt(debt._id);
    const balanceKobo = koboOf(debt) - paidSoFarKobo;

    let payment = null;
    if (balanceKobo > 0) {
      const key = `markpaid:${debt._id}:${paidSoFarKobo}`;
      try {
        payment = await repo.payments.create({
          debtId: debt._id,
          amount: koboToNaira(balanceKobo),
          amountKobo: balanceKobo,
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
        creditNgn: koboToNaira(balanceKobo),
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
    const repo = scopedRepo(req.user._id);
    const debt = await repo.debts.findById(req.params.id);
    if (!debt) return res.status(404).json({ error: "Debt not found" });

    const reminders = await repo.reminders.find({ debtId: debt._id }).sort({ createdAt: -1 });
    return res.json({ reminders });
  } catch (err) {
    console.error("listReminders error:", err.message);
    return res.status(500).json({ error: "Failed to list reminders" });
  }
}

async function remind(req, res) {
  try {
    const debt = await scopedRepo(req.user._id).debts.findById(req.params.id);
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
    const debt = await scopedRepo(req.user._id).debts.findById(req.params.id);
    if (!debt) return res.status(404).json({ error: "Debt not found" });

    const channels = [...new Set(req.body.channels || [])];
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

async function invoicePdf(req, res) {
  try {
    const debt = await scopedRepo(req.user._id).debts.findById(req.params.id);
    if (!debt) return res.status(404).json({ error: "Debt not found" });
    await ensureInvoiceNumber(debt);
    const token = await ensurePublicToken(debt);
    const view = await invoiceView(debt, req.user);
    const pdf = await buildInvoicePdf(view, { payUrl: payPageUrl(token) });
    res.set("Content-Type", "application/pdf");
    res.set("Content-Disposition", `attachment; filename="${invoiceFileName(view)}"`);
    return res.send(pdf);
  } catch (err) {
    console.error("invoice pdf error:", err.message);
    return res.status(500).json({ error: "The invoice PDF could not be made just now." });
  }
}

async function share(req, res) {
  try {
    const debt = await scopedRepo(req.user._id).debts.findById(req.params.id);
    if (!debt) return res.status(404).json({ error: "Debt not found" });
    await ensureInvoiceNumber(debt);
    const token = req.body.renew ? await rotatePublicToken(debt) : await ensurePublicToken(debt);
    return res.json({ url: payPageUrl(token), invoiceNumber: debt.invoiceNumber, renewed: Boolean(req.body.renew) });
  } catch (err) {
    console.error("share invoice error:", err.message);
    return res.status(500).json({ error: "The payment page link could not be made just now." });
  }
}

module.exports = {
  invoicePdf,
  share,
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
