/**
 * Plain-text reminder message builder — the no-AI fallback (Module 1 must work
 * with NO AI). Always embeds the owner's bank details; if none are set, it still
 * produces a message and notes that bank details are missing.
 */

function formatAmount(amount, currency) {
  const n = Number(amount) || 0;
  return `${currency || "NGN"} ${n.toLocaleString("en-NG")}`;
}

function formatDate(date) {
  const d = new Date(date);
  if (isNaN(d.getTime())) return String(date);
  // Human, hyphen-free date, e.g. "23 July 2026".
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/**
 * @param {object} p
 * @param {string} p.debtorName
 * @param {number} p.amount
 * @param {string} p.currency
 * @param {Date|string} p.dueDate
 * @param {number} p.daysOverdue   0 if not yet due
 * @param {"gentle"|"firm"} p.tone
 * @param {object} p.bankDetails   { accountName, accountNumber, bankName }
 * @param {string} [p.ownerName]
 * @returns {string}
 */
function buildReminderMessage(p) {
  const {
    debtorName,
    amount,
    amountPaid = 0,
    currency,
    dueDate,
    daysOverdue = 0,
    tone = "gentle",
    bankDetails = {},
    ownerName,
  } = p;

  const amountStr = formatAmount(amount, currency);
  const dueStr = formatDate(dueDate);
  const lines = [];

  lines.push(`Hi ${debtorName || "there"},`);

  // When part of the debt is already paid, the amount here is the remaining balance.
  const partWord = amountPaid > 0 ? "outstanding balance of " : "payment of ";

  if (daysOverdue > 0) {
    const dayWord = daysOverdue === 1 ? "day" : "days";
    lines.push(
      `I hope you are doing well. This is a gentle reminder about your ${partWord}` +
        `${amountStr}, which was due on ${dueStr} and is now ${daysOverdue} ${dayWord} past due.`
    );
  } else {
    lines.push(
      `I hope you are doing well. This is a friendly reminder that your ${partWord}` +
        `${amountStr} is due on ${dueStr}.`
    );
  }

  if (amountPaid > 0) {
    lines.push(
      `Thank you for the ${formatAmount(amountPaid, currency)} you have already paid.`
    );
  }

  if (bankDetails && bankDetails.accountNumber) {
    const bank = bankDetails.bankName ? `, ${bankDetails.bankName}` : "";
    const name = bankDetails.accountName || "my account";
    lines.push(
      `You can pay into ${name}${bank}, account number ${bankDetails.accountNumber}.`
    );
  } else {
    lines.push(
      "Please reach out to me and I will happily share my account details so you can pay."
    );
  }

  if (tone === "firm") {
    lines.push(
      "I would really appreciate it if you could settle this soon. Thank you so much."
    );
  } else {
    lines.push(
      "Thank you so much, and please let me know once you have sent it across."
    );
  }

  lines.push("");
  lines.push("Warm regards,");
  lines.push(ownerName || "");

  return lines.join("\n").trim();
}

module.exports = { buildReminderMessage, formatAmount, formatDate };
