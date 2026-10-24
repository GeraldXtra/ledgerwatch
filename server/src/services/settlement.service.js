const PaymentAddress = require("../models/PaymentAddress");
const { notifyUser } = require("./push.service");
const { paidForDebt } = require("./receivables.service");

const EMAIL_DEBOUNCE_MS = Number(process.env.SETTLEMENT_EMAIL_DEBOUNCE_MS || 20000);
const lastEmailAt = new Map();

const MAX_DEBOUNCE_KEYS = 5000;

function recentlyEmailed(debtId, fullyPaid) {
  const key = `${debtId}:${fullyPaid ? "full" : "partial"}`;
  const prev = lastEmailAt.get(key);
  const now = Date.now();
  if (prev && now - prev < EMAIL_DEBOUNCE_MS) return true;
  if (lastEmailAt.size >= MAX_DEBOUNCE_KEYS) {
    for (const [k, at] of lastEmailAt) {
      if (now - at >= EMAIL_DEBOUNCE_MS) lastEmailAt.delete(k);
    }
  }
  lastEmailAt.set(key, now);
  return false;
}

async function outstandingNgnFor(debt) {
  const paid = await paidForDebt(debt._id);
  return Math.max(0, (debt.amount || 0) - paid);
}

async function onInvoiceSettled({
  debt,
  payment,
  method = "crypto",
  creditNgn,
  fullyPaid,
  pa = null,
  chain = null,
  totalUsdc = null,
  isLate = false,
}) {
  const remainingNgn = await outstandingNgnFor(debt);

  void pa;
  const activeAddress = fullyPaid
    ? null
    : await PaymentAddress.findOne({ debtId: debt._id, status: "active" });

  const { getChain } = require("../config/chains");
  const receiptChain =
    chain || (activeAddress && activeAddress.chainId ? getChain(activeAddress.chainId) : null);

  const received =
    method === "crypto" && totalUsdc != null && pa
      ? `${totalUsdc.toFixed(2)} ${pa.tokenSymbol} confirmed on ${chain ? chain.name : "chain"}.`
      : `${Number(creditNgn).toLocaleString("en-NG")} naira recorded.`;

  await notifyUser(
    debt.userId,
    {
      title: fullyPaid
        ? `Invoice settled — ${debt.debtorName}`
        : `Part payment received — ${debt.debtorName}`,
      body: received + (isLate ? " This arrived after the payment address had expired." : ""),
      tag: `pay-${debt._id}`,
      type: "payment",
      url: "/app/receivables",
    },
    "txUpdates"
  ).catch(() => {});

  try {
    if (!debt.debtorEmail) return { emailed: false, reason: "no debtor email on file" };

     
    const { sendEmail, getLogoAttachment, isNonRoutableEmail } = require("./notify.service");
     
    const { buildPaymentReceiptEmail } = require("../utils/paymentReceipt");
     
    const User = require("../models/User");

    if (isNonRoutableEmail(debt.debtorEmail)) {
      console.warn(`[settlement] receipt not sent: ${debt.debtorEmail} would bounce.`);
      return { emailed: false, reason: "reserved domain" };
    }
    if (recentlyEmailed(debt._id, fullyPaid)) {
      console.log(
        `[settlement] ${fullyPaid ? "full" : "partial"} receipt debounced for debt ${debt._id}`
      );
      return { emailed: false, reason: "debounced" };
    }

    const owner = await User.findById(debt.userId).select("name companyName bankDetails");
    const logo = getLogoAttachment();

    const { html, text } = buildPaymentReceiptEmail({
      businessName: owner && (owner.companyName || owner.name),
      debtorName: debt.debtorName,
      method,
      amountUsdc: totalUsdc,
      tokenSymbol: pa ? pa.tokenSymbol : null,
      creditNgn,
      chain,
      txHash: payment && payment.txHash ? payment.txHash : null,
      fullyPaid,
      isLate,
      remainingNgn,
      stillOwedToken: activeAddress ? activeAddress.expectedUsdc : null,
      stillOwedSymbol: activeAddress ? activeAddress.tokenSymbol : null,
      payToAddress: activeAddress ? activeAddress.address : null,
      payToChainName: activeAddress && receiptChain ? receiptChain.name : null,
      hasLogo: Boolean(logo),
    });

    const res = await sendEmail(
      debt.debtorEmail,
      fullyPaid ? "Payment received in full. Thank you" : "Payment received. Thank you",
      html,
      { text, attachments: logo ? [logo] : [] }
    );
    if (!res.ok) console.error(`[settlement] receipt email failed: ${res.error}`);
    return { emailed: Boolean(res.ok), reason: res.ok ? null : res.error };
  } catch (err) {
    console.error("[settlement] receipt email error:", err.message);
    return { emailed: false, reason: err.message };
  }
}

module.exports = { onInvoiceSettled, outstandingNgnFor };
