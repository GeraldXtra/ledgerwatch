const { FONT, MONO, INK, BODY, MUTED, LINE, WELL, PAGE, POS, ACCENT_INK, esc, brandHeader } = require("./emailBrand");

function ngn(amount) {
  return Number(amount || 0).toLocaleString("en-NG", { maximumFractionDigits: 2 });
}

function buildPaymentReceiptEmail({
  businessName,
  debtorName,
  method = "crypto",
  amountUsdc,
  tokenSymbol,
  creditNgn,
  chain,
  txHash,
  fullyPaid,
  isLate,
  remainingNgn,
  stillOwedToken,
  stillOwedSymbol,
  payToAddress,
  payToChainName,
  hasLogo,
}) {
  const supplier = esc(businessName || "your supplier");

  const chainTxHash = /^0x[0-9a-fA-F]{64}$/.test(String(txHash || "")) ? String(txHash) : null;
  const explorer =
    chain && chain.explorer && chainTxHash ? `${chain.explorer}/tx/${chainTxHash}` : null;
  const isCrypto = method === "crypto" && amountUsdc != null && tokenSymbol;

  const headline = fullyPaid
    ? "Your payment has been received in full"
    : "Your payment has been received";

  const receivedLine = isCrypto
    ? `We have received your payment of ${Number(amountUsdc).toFixed(2)} ${tokenSymbol} on ${
        chain ? chain.name : "chain"
      }, which is ${ngn(creditNgn)} naira.`
    : `We have received your payment of ${ngn(creditNgn)} naira.`;

  const lines = [
    `Hello ${debtorName || "there"},`,
    "",
    receivedLine,
    "",
    fullyPaid
      ? "That settles your account with us in full. Thank you, and we appreciate you sorting it out."
      : `Thank you. There is ${ngn(remainingNgn)} naira still outstanding on this invoice.`,
  ];

  if (!fullyPaid && stillOwedToken > 0 && payToAddress && payToChainName) {
    lines.push(
      "",
      `To settle the rest in ${stillOwedSymbol}, send ${Number(stillOwedToken).toFixed(2)} ${stillOwedSymbol}` +
        ` on ${payToChainName}, and only on ${payToChainName}, to:`,
      payToAddress,
      "",
      "That amount already reflects what you have just paid, and is held at the rate you were originally quoted."
    );
  }

  if (isLate) {
    lines.push("", "This arrived after the payment window had closed, and it has still been credited to you in full.");
  }
  if (chainTxHash) lines.push("", `Transaction: ${chainTxHash}`);
  lines.push("", `Warm regards,`, businessName || "");

  const text = lines.join("\n");

  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title>Payment received</title>
</head>
<body style="margin:0;padding:0;background:${PAGE};-webkit-text-size-adjust:100%">
<div style="display:none;font-size:1px;color:${PAGE};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden">${esc(
    isCrypto
      ? `${Number(amountUsdc).toFixed(2)} ${tokenSymbol} received by ${supplier}`
      : `${ngn(creditNgn)} naira received by ${supplier}`
  )}</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAGE};padding:28px 12px">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
           style="width:100%;max-width:600px;background:#ffffff;border:1px solid ${LINE};border-radius:12px;overflow:hidden">

      ${brandHeader({ hasLogo, subtitle: `Payment receipt from ${businessName || "your supplier"}` })}

      <tr><td style="padding:24px 28px 4px">
        <div style="font:600 17px ${FONT};color:${POS};padding-bottom:12px">${headline}</div>
        <p style="margin:0 0 14px;font:400 15px/1.7 ${FONT};color:${BODY}">
          Hello ${esc(debtorName || "there")}, thank you. We have received your payment and credited it to your account.
        </p>
      </td></tr>

      <tr><td style="padding:0 28px 4px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
               style="background:${WELL};border:1px solid ${LINE};border-radius:12px">
          <tr><td style="padding:16px 18px">
            <div style="font:600 11px ${FONT};color:${MUTED}">Amount received</div>
            <div style="font:700 24px ${FONT};color:${INK};padding-top:5px">${
              isCrypto
                ? `${Number(amountUsdc).toFixed(2)} ${esc(tokenSymbol)}`
                : `&#8358;${ngn(creditNgn)}`
            }</div>
            <div style="font:400 13px ${FONT};color:${MUTED};padding-top:4px">${
              isCrypto
                ? `&#8358;${ngn(creditNgn)} &middot; ${esc(chain ? chain.name : "")}`
                : "Bank transfer"
            }</div>
          </td></tr>
        </table>
      </td></tr>

      ${
        fullyPaid
          ? `<tr><td style="padding:16px 28px 4px">
               <div style="padding:12px 16px;border-radius:10px;background:#F2F8F0;font:600 14px ${FONT};color:${POS}">
                 This settles your account in full. Nothing further is outstanding.
               </div>
             </td></tr>`
          : `<tr><td style="padding:16px 28px 4px">
               <div style="padding:12px 16px;border-radius:10px;background:${WELL};font:400 14px ${FONT};color:${BODY}">
                 <strong style="color:${INK}">&#8358;${ngn(remainingNgn)}</strong> is still outstanding on this invoice.
               </div>
             </td></tr>${
               stillOwedToken > 0 && payToAddress && payToChainName
                 ? `<tr><td style="padding:12px 28px 4px">
               <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                      style="background:${WELL};border:1px solid ${LINE};border-radius:12px">
                 <tr><td style="padding:16px 18px">
                   <div style="font:600 11px ${FONT};color:${MUTED}">To settle the rest in ${esc(
                     stillOwedSymbol || ""
                   )}</div>
                   <div style="font:700 20px ${FONT};color:${INK};padding-top:5px">${Number(
                     stillOwedToken
                   ).toFixed(2)} ${esc(stillOwedSymbol || "")}</div>
                   <div style="font:400 13px ${FONT};color:${MUTED};padding-top:4px">on ${esc(
                     payToChainName
                   )}. This network only</div>
                   <div style="font:600 11px ${FONT};color:${MUTED};padding-top:12px">Send to</div>
                   <div style="font:400 13px/1.5 ${FONT};color:${INK};word-break:break-all;padding-top:4px">${esc(
                     payToAddress
                   )}</div>
                 </td></tr>
               </table>
             </td></tr>`
                 : ""
             }`
      }

      ${
        isLate
          ? `<tr><td style="padding:12px 28px 0"><p style="margin:0;font:400 13px/1.6 ${FONT};color:${MUTED}">
               This arrived after the payment window had closed, and it has still been credited to you in full.
             </p></td></tr>`
          : ""
      }

      ${
        explorer
          ? `<tr><td style="padding:16px 28px 4px">
               <div style="font:600 11px ${FONT};color:${MUTED};padding-bottom:6px">Transaction</div>
               <div style="font:600 12px/1.5 ${MONO};word-break:break-all;color:${INK}">${esc(chainTxHash)}</div>
               <a href="${esc(explorer)}" style="display:inline-block;margin-top:8px;font:600 13px ${FONT};color:${ACCENT_INK};text-decoration:underline">View it on the blockchain explorer</a>
             </td></tr>`
          : ""
      }

      <tr><td style="padding:22px 28px 24px">
        <div style="border-top:1px solid ${LINE};padding-top:16px;font:400 12px/1.6 ${FONT};color:${MUTED}">
          Reply to this email if anything here looks wrong to you.<br>
          Sent with <span style="color:${BODY};font-weight:600">LedgerWatch</span>.
        </div>
      </td></tr>

    </table>
  </td></tr>
</table>
</body></html>`;

  return { html, text };
}

module.exports = { buildPaymentReceiptEmail };
