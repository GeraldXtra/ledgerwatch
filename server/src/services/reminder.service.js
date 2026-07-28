const Reminder = require("../models/Reminder");
const Payment = require("../models/Payment");
const { normalizePhone } = require("../utils/phone");
const { buildReminderMessage } = require("../utils/reminderTemplate");
const { draftReminder } = require("./anthropic.service");
const { sendWhatsApp, sendEmail, buildReminderEmail } = require("./notify.service");

const DAY_MS = 24 * 60 * 60 * 1000;

// Idempotency: has this debt already had a SUCCESSFUL send on `channel` within its
// current cadence window? Persisted in Mongo, so it survives restarts.
async function recentlySentOn(debt, channel) {
  const cadenceMs = (debt.reminderCadenceDays || 3) * DAY_MS;
  const since = new Date(Date.now() - cadenceMs);
  const existing = await Reminder.findOne({
    debtId: debt._id,
    deliveries: { $elemMatch: { channel, status: "sent", at: { $gte: since } } },
  });
  return Boolean(existing);
}

/**
 * Dispatch a generated reminder over the requested channels, recording a per-channel
 * delivery on the reminder doc. Idempotent within the cadence window (unless forced).
 * @param {object} reminder  the Reminder doc from generateReminderForDebt
 * @param {object} debt      the Debt doc
 * @param {object} owner     the User (name + bankDetails)
 * @param {{channels:string[], force?:boolean}} opts
 * @returns {Promise<Array>} the delivery records
 */
async function dispatchReminder(reminder, debt, owner, { channels = [], force = false } = {}) {
  const results = [];
  for (const channel of channels) {
    if (!force && (await recentlySentOn(debt, channel))) {
      results.push({ channel, status: "skipped", error: "Already sent this cadence window", at: new Date() });
      continue;
    }
    let res;
    if (channel === "whatsapp") {
      res = await sendWhatsApp(debt.debtorPhone, reminder.messageText);
    } else if (channel === "email") {
      const html = buildReminderEmail({
        businessName: owner && owner.name,
        messageText: reminder.messageText,
        bankDetails: (owner && owner.bankDetails) || {},
      });
      res = await sendEmail(debt.debtorEmail, `Payment reminder from ${(owner && owner.name) || "your supplier"}`, html);
    } else {
      continue;
    }
    results.push({
      channel,
      status: res.ok ? "sent" : res.skipped ? "skipped" : "failed",
      providerId: res.providerId,
      error: res.error,
      at: new Date(),
    });
  }
  if (results.length) {
    reminder.deliveries.push(...results);
    if (results.some((d) => d.status === "sent")) reminder.status = "sent";
    await reminder.save();
  }
  return results;
}

function daysOverdueFor(dueDate) {
  const diff = Date.now() - new Date(dueDate).getTime();
  return Math.max(0, Math.floor(diff / DAY_MS));
}

// Outstanding balance = amount - sum(payments). Reminders reference this, not the
// original amount, so a partly-paid debtor is asked for what they still owe.
async function outstandingBalance(debt) {
  const rows = await Payment.aggregate([
    { $match: { debtId: debt._id } },
    { $group: { _id: null, paid: { $sum: "$amount" } } },
  ]);
  const paid = rows.length ? rows[0].paid : 0;
  return { balance: Math.max(0, (debt.amount || 0) - paid), amountPaid: paid };
}

/**
 * Shared reminder engine — the ONE source of truth for generating a reminder for
 * a debt. Used by BOTH the manual POST /api/debts/:id/remind route and the
 * automation reminder pass, so their behavior is always identical.
 *
 * Drafts the message (AI via anthropic.service if configured, else the plain
 * template), creates a Reminder doc (status "scheduled"), updates the debt's
 * lastRemindedAt + "reminded" history, and returns the response payload.
 *
 * @param {import("mongoose").Document} debt   a Debt document (will be mutated + saved)
 * @param {object} owner  the debt owner (User doc/object with name + bankDetails)
 * @returns {Promise<object>} { reminder, messageText, waLink, phoneValid,
 *   bankDetailsMissing, daysOverdue, tone, source }
 */
async function generateReminderForDebt(debt, owner) {
  const bankDetails = (owner && owner.bankDetails) || {};
  const bankDetailsMissing = !bankDetails.accountNumber;

  const daysOverdue = daysOverdueFor(debt.dueDate);
  const priorReminders = (debt.history || []).filter(
    (h) => h.event === "reminded"
  ).length;
  const tone = daysOverdue > 7 || priorReminders >= 2 ? "firm" : "gentle";

  // Ask for the outstanding balance, and note prior part-payments.
  const { balance, amountPaid } = await outstandingBalance(debt);
  const owed = balance > 0 ? balance : debt.amount;

  const params = {
    debtorName: debt.debtorName,
    amount: owed,
    originalAmount: debt.amount,
    amountPaid,
    currency: debt.currency,
    dueDate: debt.dueDate,
    daysOverdue,
    tone,
    bankDetails,
    ownerName: owner && owner.name,
  };

  // AI draft with graceful fallback to the plain template.
  const aiText = await draftReminder(params);
  const source = aiText ? "ai" : "template";
  const messageText = aiText || buildReminderMessage(params);

  const reminder = await Reminder.create({
    debtId: debt._id,
    userId: debt.userId,
    messageText,
    scheduledFor: new Date(),
    status: "scheduled",
  });

  debt.lastRemindedAt = new Date();
  debt.history.push({ event: "reminded" });
  await debt.save();

  // Build wa.me link (null if phone missing/invalid so the UI can disable the button).
  const { valid, intl } = normalizePhone(debt.debtorPhone);
  const waLink = valid
    ? `https://wa.me/${intl}?text=${encodeURIComponent(messageText)}`
    : null;

  return {
    reminder,
    messageText,
    waLink,
    phoneValid: valid,
    bankDetailsMissing,
    daysOverdue,
    tone,
    source,
  };
}

module.exports = {
  generateReminderForDebt,
  dispatchReminder,
  recentlySentOn,
  daysOverdueFor,
  DAY_MS,
};
