const Reminder = require("../models/Reminder");
const PaymentAddress = require("../models/PaymentAddress");
const { normalizePhone } = require("../utils/phone");
const { buildReminderMessage } = require("../utils/reminderTemplate");
const { cryptoBlockText, cryptoBlockHtml } = require("../utils/cryptoPaymentBlock");
const { getChain } = require("../config/chains");
const { draftReminder } = require("./anthropic.service");
const { paidForDebt } = require("./receivables.service");
const {
  sendWhatsApp,
  sendEmail,
  buildReminderEmail,
  getLogoAttachment,
} = require("./notify.service");

const DAY_MS = 24 * 60 * 60 * 1000;

function formatDueDate(value) {
  if (!value) return "";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

async function recentlySentOn(debt, channel) {
  const cadenceMs = (debt.reminderCadenceDays || 3) * DAY_MS;
  const since = new Date(Date.now() - cadenceMs);
  const existing = await Reminder.findOne({
    debtId: debt._id,
    deliveries: { $elemMatch: { channel, status: "sent", at: { $gte: since } } },
  });
  return Boolean(existing);
}

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
      const attachments = [];
      const logo = getLogoAttachment();
      if (logo) attachments.push(logo);

      let cryptoHtml = "";
      const active = await PaymentAddress.findOne({
        debtId: debt._id,
        status: "active",
        expiresAt: { $gt: new Date() },
      });
      if (active) {
        const chain = getChain(active.chainId);
        if (chain) {
          let qrCid = null;
          try {
             
            const QRCode = require("qrcode");
            const buffer = await QRCode.toBuffer(active.address, {
              width: 220,
              margin: 1,
              errorCorrectionLevel: "M",
              color: { dark: "#0a1428", light: "#ffffff" },
            });
            qrCid = "payment-address-qr";
            attachments.push({
              filename: "payment-address.png",
              content: buffer,
              cid: qrCid,
              contentDisposition: "inline",
            });
          } catch (err) {
            console.error("Reminder QR generation failed:", err.message);
          }
          cryptoHtml = cryptoBlockHtml(active, chain, qrCid, Boolean(logo));
        }
      }

      const { balance } = await outstandingBalance(debt);
      const html = buildReminderEmail({
        businessName: owner && owner.name,
        debtorName: debt.debtorName,
        amount: balance > 0 ? balance : debt.amount,
        dueDate: formatDueDate(debt.dueDate),
        messageText: cryptoHtml ? reminder.baseMessageText || reminder.messageText : reminder.messageText,
        bankDetails: (owner && owner.bankDetails) || {},
        cryptoHtml,
        hasLogo: Boolean(logo),
      });
      res = await sendEmail(
        debt.debtorEmail,
        `Payment reminder from ${(owner && owner.name) || "your supplier"}`,
        html,
        { text: reminder.messageText, attachments }
      );
    } else {
      continue;
    }
    results.push({
      channel,
      status: res.ok ? "sent" : res.queued ? "queued" : res.skipped ? "skipped" : "failed",
      providerId: res.providerId,
      reason: res.reason,
      error: res.error,
      warning: res.warning,
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

async function outstandingBalance(debt) {
  const paid = await paidForDebt(debt._id);
  return { balance: Math.max(0, (debt.amount || 0) - paid), amountPaid: paid };
}

async function generateReminderForDebt(debt, owner) {
  const bankDetails = (owner && owner.bankDetails) || {};
  const bankDetailsMissing = !bankDetails.accountNumber;

  const daysOverdue = daysOverdueFor(debt.dueDate);
  const priorReminders = (debt.history || []).filter(
    (h) => h.event === "reminded"
  ).length;
  const tone = daysOverdue > 7 || priorReminders >= 2 ? "firm" : "gentle";

  const { balance, amountPaid } = await outstandingBalance(debt);

  if (balance <= 0 || debt.status === "paid") {
    const err = new Error(
      "This invoice is settled. There is nothing outstanding to remind the debtor about."
    );
    err.status = 409;
    throw err;
  }
  const owed = balance;

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

  const aiText = await draftReminder(params);
  const source = aiText ? "ai" : "template";
  const baseText = aiText || buildReminderMessage(params);

  const activeAddress = await PaymentAddress.findOne({
    debtId: debt._id,
    status: "active",
    expiresAt: { $gt: new Date() },
  });

  let messageText = baseText;
  if (activeAddress) {
    const chain = getChain(activeAddress.chainId);
    if (chain) {
      const block = cryptoBlockText(activeAddress, chain);
      const idx = baseText.lastIndexOf("\nWarm regards,");
      messageText =
        idx === -1
          ? `${baseText.replace(/\s+$/, "")}\n${block}`
          : `${baseText.slice(0, idx).replace(/\s+$/, "")}\n${block}\n${baseText.slice(idx + 1)}`;
    }
  }

  const reminder = await Reminder.create({
    debtId: debt._id,
    userId: debt.userId,
    messageText,
    baseMessageText: baseText,
    scheduledFor: new Date(),
    status: "scheduled",
  });

  debt.lastRemindedAt = new Date();
  debt.history.push({ event: "reminded" });
  await debt.save();

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
