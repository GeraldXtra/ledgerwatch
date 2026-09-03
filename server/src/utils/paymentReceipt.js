/**
 * The receipt a payer gets when their crypto payment settles.
 *
 * Same table-based, inline-styled construction as the reminder email, and the
 * same CID logo attachment, because Gmail strips `data:` images. Built
 * programmatically and never model-generated: it states amounts and a
 * transaction hash, and those must be exact.
 *
 * House style: warm, plain, and free of hyphens and dashes.
 */

const FONT = "'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const INK = "#0a1428";
const GOLD = "#c0a053";
const BODY = "#3a4658";
const MUTED = "#64748b";
const LINE = "#e1e7f0";
const WELL = "#f4f7fa";
const POS = "#1c7a52";

function esc(s) {
  return String(s == null ? "" : s).replace(
    /[<>&"]/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c])
  );
}

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
  // Partial payments only: what is STILL needed, recalculated from the new
  // balance at the original snapshot rate, plus where to send it. Repeated here
  // so the payer never has to dig out the first email to finish paying.
  stillOwedToken,
  stillOwedSymbol,
  payToAddress,
  payToChainName,
  hasLogo,
}) {
  const supplier = esc(businessName || "your supplier");
  const explorer = chain && chain.explorer && txHash ? `${chain.explorer}/tx/${txHash}` : null;
  const isCrypto = method === "crypto" && amountUsdc != null && tokenSymbol;

  const headline = fullyPaid
    ? "Your payment has been received in full"
    : "Your payment has been received";

  // Describes what actually happened. A bank payment has no token, no chain and
  // no transaction hash, and saying otherwise would be plainly wrong.
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

  /**
   * The network is REQUIRED here, exactly as it is in the HTML half below.
   * This branch used to make it optional, so the plain text alternative, which
   * is what WhatsApp and many mail clients show, could print an address with no
   * network at all. The same address exists on every EVM chain and a payment
   * sent on the wrong one is gone. No network, no address.
   */
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
  if (txHash) lines.push("", `Transaction: ${txHash}`);
  lines.push("", `Warm regards,`, businessName || "");

  const text = lines.join("\n");

  const logoCell = hasLogo
    ? `<img src="cid:ledgerwatch-logo" width="36" height="36" alt="" style="display:block;border:0;border-radius:9px" />`
    : "";

  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title>Payment received</title>
</head>
<body style="margin:0;padding:0;background:#eef2f8;-webkit-text-size-adjust:100%">
<div style="display:none;font-size:1px;color:#eef2f8;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden">${esc(
    // Preheader — the line mail clients show beside the subject. Unguarded it
    // rendered "NaN undefined received by …" on every bank receipt.
    isCrypto
      ? `${Number(amountUsdc).toFixed(2)} ${tokenSymbol} received by ${supplier}`
      : `${ngn(creditNgn)} naira received by ${supplier}`
  )}</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef2f8;padding:28px 12px">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
           style="width:100%;max-width:600px;background:#ffffff;border:1px solid ${LINE};border-radius:16px;overflow:hidden">

      <tr><td style="height:4px;background:${GOLD};line-height:4px;font-size:0">&nbsp;</td></tr>

      <tr><td style="padding:24px 28px 18px;border-bottom:1px solid ${LINE}">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          ${logoCell ? `<td style="padding-right:12px;vertical-align:middle">${logoCell}</td>` : ""}
          <td style="vertical-align:middle">
            <div style="font:700 19px ${FONT};color:${INK};letter-spacing:-.2px">Ledger<span style="color:${GOLD}">Watch</span></div>
            <div style="font:400 12px ${FONT};color:${MUTED};padding-top:2px">Payment receipt from ${supplier}</div>
          </td>
        </tr></table>
      </td></tr>

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
            <div style="font:600 11px ${FONT};letter-spacing:.08em;text-transform:uppercase;color:${MUTED}">Amount received</div>
            <!-- Bank payments have no token and no chain. Reading chain.name
                 unguarded here would throw on every bank receipt. -->
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
               <div style="padding:12px 16px;border-radius:10px;background:#e6f4ee;font:600 14px ${FONT};color:${POS}">
                 This settles your account in full. Nothing further is outstanding.
               </div>
             </td></tr>`
          : `<tr><td style="padding:16px 28px 4px">
               <div style="padding:12px 16px;border-radius:10px;background:${WELL};font:400 14px ${FONT};color:${BODY}">
                 <strong style="color:${INK}">&#8358;${ngn(remainingNgn)}</strong> is still outstanding on this invoice.
               </div>
             </td></tr>${
               /* Everything needed to finish paying, repeated. The amount is
                  RECALCULATED from the new balance at the rate originally
                  quoted, so it already accounts for what was just paid — the
                  payer never has to work it out or find the first email. */
               /* A CRYPTO BLOCK WITHOUT A NETWORK IS NOT RENDERED AT ALL.
                  Requiring payToChainName here is the structural half of LW-007:
                  the tactical fix was to resolve the chain in the caller, and
                  this is what makes forgetting it impossible to ship. An address
                  with an amount and no network is worse than no block, because
                  the same address exists on every EVM chain and the payer has
                  been given everything they need to destroy the funds. If the
                  chain cannot be resolved the payer is told to reply for
                  details instead. */
               stillOwedToken > 0 && payToAddress && payToChainName
                 ? `<tr><td style="padding:12px 28px 4px">
               <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                      style="background:${WELL};border:1px solid ${LINE};border-radius:12px">
                 <tr><td style="padding:16px 18px">
                   <div style="font:600 11px ${FONT};letter-spacing:.08em;text-transform:uppercase;color:${MUTED}">To settle the rest in ${esc(
                     stillOwedSymbol || ""
                   )}</div>
                   <div style="font:700 20px ${FONT};color:${INK};padding-top:5px">${Number(
                     stillOwedToken
                   ).toFixed(2)} ${esc(stillOwedSymbol || "")}</div>
                   <div style="font:400 13px ${FONT};color:${MUTED};padding-top:4px">on ${esc(
                     payToChainName
                   )}. This network only</div>
                   <div style="font:600 11px ${FONT};letter-spacing:.08em;text-transform:uppercase;color:${MUTED};padding-top:12px">Send to</div>
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
               <div style="font:600 11px ${FONT};letter-spacing:.08em;text-transform:uppercase;color:${MUTED};padding-bottom:6px">Transaction</div>
               <div style="font:600 12px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;word-break:break-all;color:${INK}">${esc(txHash)}</div>
               <a href="${explorer}" style="display:inline-block;margin-top:8px;font:600 13px ${FONT};color:#22406f;text-decoration:underline">View it on the blockchain explorer</a>
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
