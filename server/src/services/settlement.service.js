const PaymentAddress = require("../models/PaymentAddress");
const { notifyActivity } = require("./activity.service");
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

  const naira = `₦${Number(creditNgn || 0).toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;
  const leftNaira = `₦${Number(remainingNgn || 0).toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;
  const isCryptoPayment = method === "crypto" && totalUsdc != null && pa;
  const explorer =
    isCryptoPayment && chain && chain.explorer && payment && /^0x[0-9a-fA-F]{64}$/.test(String(payment.txHash || ""))
      ? `${chain.explorer}/tx/${payment.txHash}`
      : null;
  await notifyActivity(debt.userId, {
    category: "moneyIn",
    tag: `pay-${debt._id}`,
    url: "/app/receivables",
    symbol: isCryptoPayment ? pa.tokenSymbol : null,
    title: fullyPaid ? `Invoice settled: ${debt.debtorName}` : `Part payment received: ${debt.debtorName}`,
    body: received + (isLate ? " This arrived after the payment address had expired." : ""),
    email: {
      subject: fullyPaid
        ? `${debt.debtorName} has paid in full`
        : `${debt.debtorName} paid ${naira}`,
      intro: fullyPaid
        ? `${debt.debtorName} has settled their invoice. Nothing more is owed on it.`
        : `${debt.debtorName} has made a part payment. ${leftNaira} is still owed on this invoice.`,
      tone: "pos",
      hero: {
        label: "Payment received",
        value: isCryptoPayment ? `${Number(totalUsdc).toFixed(2)} ${pa.tokenSymbol}` : naira,
        sub: isCryptoPayment ? `${naira} on ${chain ? chain.name : "chain"}` : method === "bank" ? "Bank transfer" : "Recorded payment",
      },
      rows: [
        { label: "Debtor", value: debt.debtorName },
        { label: "Invoice total", value: `₦${Number(debt.amount || 0).toLocaleString("en-NG", { maximumFractionDigits: 2 })}` },
        { label: "Still owed", value: leftNaira },
        { label: "Late payment", value: isLate ? "Yes, after the address had expired" : undefined },
        explorer ? { label: "Transaction", value: `${payment.txHash.slice(0, 10)}…${payment.txHash.slice(-6)}`, href: explorer, mono: true } : null,
      ],
    },
  }).catch(() => {});

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
