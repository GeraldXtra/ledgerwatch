const Reminder = require("../models/Reminder");
const PaymentAddress = require("../models/PaymentAddress");
const { normalizePhone } = require("../utils/phone");
const { buildReminderMessage, formatAmount } = require("../utils/reminderTemplate");
const { cryptoBlockText, cryptoBlockHtml } = require("../utils/cryptoPaymentBlock");
const { getChain } = require("../config/chains");
const { draftReminder } = require("./anthropic.service");
const { paidKoboForDebt } = require("./receivables.service");
const { koboOf, koboToNaira } = require("../domain/money");
const {
  sendWhatsApp,
  sendEmail,
  buildReminderEmail,
  getLogoAttachment,
} = require("./notify.service");
const { ensureInvoiceNumber, ensurePublicToken, payPageUrl } = require("./invoice.service");
const { isOptedOut, unsubscribeLinks } = require("./unsubscribe.service");

const DAY_MS = 24 * 60 * 60 * 1000;

function businessNameOf(owner) {
  return (owner && (owner.companyName || owner.name)) || "your supplier";
}

function insertBeforeSignOff(text, block) {
  const idx = text.lastIndexOf("\nWarm regards,");
  return idx === -1
    ? `${text.replace(/\s+$/, "")}\n${block}`
    : `${text.slice(0, idx).replace(/\s+$/, "")}\n${block}\n${text.slice(idx + 1)}`;
}

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
      res = await sendWhatsApp(debt.debtorPhone, reminder.messageText, await reminderTemplateFor(debt, owner));
    } else if (channel === "email") {
      if (await isOptedOut(debt.userId, debt.debtorEmail)) {
        results.push({
          channel,
          status: "skipped",
          reason: "unsubscribed",
          error: `${debt.debtorEmail} has asked not to receive payment reminder emails from you, so none was sent. WhatsApp and the payment page link still work.`,
          at: new Date(),
        });
        continue;
      }
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
      const business = businessNameOf(owner);
      const payUrl = payPageUrl(await ensurePublicToken(debt));
      const invoiceNumber = await ensureInvoiceNumber(debt);
      const unsubscribe = unsubscribeLinks({ kind: "debtor", userId: debt.userId, email: debt.debtorEmail });
      const html = buildReminderEmail({
        businessName: business,
        debtorName: debt.debtorName,
        amount: balance > 0 ? balance : debt.amount,
        dueDate: formatDueDate(debt.dueDate),
        messageText: reminder.baseMessageText || reminder.messageText,
        bankDetails: (owner && owner.bankDetails) || {},
        cryptoHtml,
        hasLogo: Boolean(logo),
        invoiceNumber,
        payUrl,
        unsubscribeUrl: unsubscribe.page,
      });
      res = await sendEmail(
        debt.debtorEmail,
        `Payment reminder from ${business} for invoice ${invoiceNumber}`,
        html,
        {
          text: `${reminder.messageText}\n\nStop payment reminder emails from ${business}: ${unsubscribe.page}`,
          attachments,
          category: "reminder",
          unsubscribe,
          replyTo: owner && owner.email,
        }
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
  const paidKobo = await paidKoboForDebt(debt._id);
  return {
    balance: koboToNaira(Math.max(0, koboOf(debt) - paidKobo)),
    amountPaid: koboToNaira(paidKobo),
  };
}

async function reminderTemplateFor(debt, owner) {
  const { balance } = await outstandingBalance(debt);
  return {
    debtorName: debt.debtorName,
    businessName: businessNameOf(owner),
    amount: formatAmount(balance > 0 ? balance : debt.amount, debt.currency),
    dueDate: formatDueDate(debt.dueDate),
    payUrl: payPageUrl(await ensurePublicToken(debt)),
  };
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
    ownerName: businessNameOf(owner),
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
    if (chain) messageText = insertBeforeSignOff(messageText, cryptoBlockText(activeAddress, chain));
  }
  const invoiceNumber = await ensureInvoiceNumber(debt);
  const payUrl = payPageUrl(await ensurePublicToken(debt));
  if (payUrl) messageText = insertBeforeSignOff(messageText, `See invoice ${invoiceNumber} and pay online: ${payUrl}`);

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
