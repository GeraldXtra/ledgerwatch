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

// ---- validation helpers ---------------------------------------------------

/**
 * The text fields, with the longest value each may hold. A name is a name and
 * a note is a paragraph; anything longer is a payload, and every one of these
 * ends up in an email, a WhatsApp message, a statement and a push notification.
 * An object where a string was expected used to reach Mongoose and answer 500.
 */
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
    const term = String(search || "").trim().slice(0, 100);
    if (term) {
      const rx = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [{ debtorName: rx }, { debtorPhone: rx }];
    }
    if (from || to) {
      // An unparseable date used to become `Invalid Date` inside the query and
      // answer 500; it is a 400 with the reason now.
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
    /**
     * A MALFORMED ID IS NOT AN OUTAGE.
     *
     * This caught everything and answered "Debt not found", so a Mongo failure,
     * a timeout or a bug in `attachTotals` all told the owner their invoice had
     * been deleted. They then go looking for a record that is sitting there
     * perfectly intact. Only a bad id — which is genuinely "no such thing" —
     * keeps the 404; everything else says what it is.
     */
    if (err && err.name === "CastError") {
      return res.status(404).json({ error: "Debt not found" });
    }
    console.error("getOne debt error:", err.message);
    return res.status(500).json({ error: "Could not load that invoice just now." });
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
      // THE canonical sum (LW-034). Was a hand-written aggregation, one of nine.
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

    /**
     * REFUSE TO DELETE AN INVOICE THAT IS STILL HOLDING MONEY. (LW-103.)
     *
     * `PaymentAddress` is not bookkeeping. It is the only record of the
     * DERIVATION INDEX, and the index is the only thing that says which key at
     * m/44'/60'/0'/2/<n> reaches the funds at that address. Deleting the row
     * deleted that, and `User.crypto.nextDerivationIndex` only ever moves
     * forward, so the index cannot be recovered by counting either. The money
     * stayed reachable in principle — the owner's recovery phrase still controls
     * it — and unreachable in practice, because nothing left in the product
     * could say where it was.
     *
     * The confirmation dialog said "This removes its payments and reminders",
     * which was true and was not the dangerous part.
     */
    const addressesHeld = await PaymentAddress.find({
      debtId: debt._id,
      userId: req.user._id,
    }).lean();

    const holding = addressesHeld.filter((pa) => {
      const seen = (pa.observed || [])
        .filter((o) => o.status === "confirmed")
        .reduce((sum, o) => sum + Number(o.value || 0) / 10 ** (pa.tokenDecimals || 6), 0);
      const swept = (pa.sweeps || []).reduce((sum, x) => sum + (Number(x.amountUsdc) || 0), 0);
      // One unit at the token's own precision, so floating-point noise in the
      // division above cannot register as a balance.
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
      // Deleted anyway, on the owner's explicit say-so. The index is the one
      // fact that cannot be reconstructed, so it goes in the log where a human
      // can still find it.
      console.warn(
        `[debts] invoice ${debt._id} deleted with unswept funds, forced by the owner. ` +
          holding
            .map((pa) => `${pa.address} (chain ${pa.chainId}, index ${pa.derivationIndex})`)
            .join("; ")
      );
    }

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

    // THE canonical sum (LW-034).
    const paidSoFar = await paidForDebt(debt._id);
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
      /**
       * `markpaid:<debtId>:<paidSoFar>` IS AN IDEMPOTENCY KEY, NOT A REFERENCE.
       *
       * It is stored in `txHash` because that is where the unique index lives,
       * and the receipt prints `txHash` as a "Transaction:" line — so a customer
       * whose invoice was force settled received a receipt quoting an internal
       * database id as though it were a payment reference. Force settling
       * records money that moved somewhere this app cannot see; the honest
       * receipt names no transaction at all.
       */
      const forReceipt = { ...payment.toObject(), txHash: null };

      /**
       * THE OUTCOME IS READ, NOT DISCARDED (LW-028). This call site was added
       * after LW-028's table was written, so the register names only its twin
       * in payments.controller. A receipt that never went out used to leave no
       * trace here at all — not even a log line — while the owner saw the
       * invoice close and assumed the customer had been told.
       */
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
    // A settled invoice answers 409 with the reason (LW-018), not a 500.
    if (err && err.status) return res.status(err.status).json({ error: err.message });
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
