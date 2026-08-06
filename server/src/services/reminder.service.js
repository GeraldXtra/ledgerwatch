const Reminder = require("../models/Reminder");
const Payment = require("../models/Payment");
const PaymentAddress = require("../models/PaymentAddress");
const { normalizePhone } = require("../utils/phone");
const { buildReminderMessage } = require("../utils/reminderTemplate");
const { cryptoBlockText, cryptoBlockHtml } = require("../utils/cryptoPaymentBlock");
const { getChain } = require("../config/chains");
const { draftReminder } = require("./anthropic.service");
const {
  sendWhatsApp,
  sendEmail,
  buildReminderEmail,
  getLogoAttachment,
} = require("./notify.service");

const DAY_MS = 24 * 60 * 60 * 1000;

/** "12 August 2026", or "" when there is no usable date. */
function formatDueDate(value) {
  if (!value) return "";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

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
      // The email gets the richer crypto block: a copyable monospace address plus a
      // scannable QR, so the payer never has to retype 42 characters by hand. The
      // plain-text message already carries the same details for WhatsApp.
      //
      // Images are attached INLINE and referenced by content id. Gmail strips
      // `data:` URI images, so a QR embedded that way is invisible to most
      // recipients however correct the markup looks.
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
            // eslint-disable-next-line global-require
            const QRCode = require("qrcode");
            // 220px, not 340. It renders at 170px in the email, so 340 was
            // paying for pixels nobody sees — and image weight against text is
            // one of the things spam filters actually score. Error correction
            // stays at M so the code still reads from a phone screen.
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
            // A missing QR must never block the reminder — the address is still
            // present in text form right above it. But it must not fail SILENTLY
            // either: `qrcode` was absent from the server's dependencies for a
            // while and a bare catch here meant no QR ever rendered and nothing
            // ever said so.
            console.error("Reminder QR generation failed:", err.message);
          }
          cryptoHtml = cryptoBlockHtml(active, chain, qrCid, Boolean(logo));
        }
      }

      // Reuse the one balance helper the reminders already quote from, so the
      // figure in the email header can never disagree with the letter itself.
      const { balance } = await outstandingBalance(debt);
      const html = buildReminderEmail({
        businessName: owner && owner.name,
        debtorName: debt.debtorName,
        amount: balance > 0 ? balance : debt.amount,
        dueDate: formatDueDate(debt.dueDate),
        // Base text here, not messageText: the crypto details are rendered below
        // as rich HTML, so using the full text would duplicate them.
        messageText: cryptoHtml ? reminder.baseMessageText || reminder.messageText : reminder.messageText,
        bankDetails: (owner && owner.bankDetails) || {},
        cryptoHtml,
        hasLogo: Boolean(logo),
      });
      res = await sendEmail(
        debt.debtorEmail,
        `Payment reminder from ${(owner && owner.name) || "your supplier"}`,
        html,
        // The full text version, crypto block included, as the text/plain part.
        { text: reminder.messageText, attachments }
      );
    } else {
      continue;
    }
    results.push({
      channel,
      status: res.ok ? "sent" : res.skipped ? "skipped" : "failed",
      providerId: res.providerId,
      // `reason` is the machine-readable cause; `error` is what the user reads.
      // `warning` covers a send that succeeded at the handshake but will not
      // actually arrive, which used to be indistinguishable from a clean send.
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
  const baseText = aiText || buildReminderMessage(params);

  /**
   * The crypto block is APPENDED here, identically for the AI and template paths,
   * rather than being described to the model and left for it to reproduce.
   *
   * An address is 42 characters with no human-noticeable checksum: if the model
   * transposed one character the payer would send real money to an address nobody
   * controls, unrecoverably. The same goes for the amount. So the model writes the
   * human paragraphs and the machine writes the numbers.
   */
  const activeAddress = await PaymentAddress.findOne({
    debtId: debt._id,
    status: "active",
    expiresAt: { $gt: new Date() },
  });

  let messageText = baseText;
  if (activeAddress) {
    const chain = getChain(activeAddress.chainId);
    if (chain) {
      // Sign-off sits at the end of the base text, so the payment details go in
      // before it rather than after the "Warm regards" line.
      const block = cryptoBlockText(activeAddress, chain);
      const idx = baseText.lastIndexOf("\nWarm regards,");
      // The block opens with its own blank line, and the text before the sign-off
      // ends with one too. Trimming the left side keeps that to a single blank
      // line instead of stacking two.
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
