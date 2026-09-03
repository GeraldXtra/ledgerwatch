/**
 * The crypto payment section of a reminder.
 *
 * SAFETY: this text is built PROGRAMMATICALLY and is never produced by the language
 * model. An address is 42 characters with no redundancy and no checksum a human
 * would notice — a single wrong character sends the money to an address nobody
 * controls, permanently. So the model writes the human paragraphs and this block is
 * concatenated afterwards, byte for byte identical in the AI and template paths.
 *
 * House style: warm, plain, and NO hyphens or dashes of any kind (the existing
 * reminder copy deliberately avoids them, so this matches).
 */

/** e.g. "1,250,000" */
function ngn(amount) {
  return Number(amount || 0).toLocaleString("en-NG", { maximumFractionDigits: 2 });
}

/** USDC always shows 2 decimals so the payer sees exactly what to send. */
function usdc(amount) {
  return Number(amount || 0).toFixed(2);
}

function expiryWords(expiresAt) {
  const d = new Date(expiresAt);
  if (isNaN(d.getTime())) return "";
  const date = d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return `${date} at ${time}`;
}

/**
 * Plain-text block for WhatsApp and the template path.
 * @param {object} pa   PaymentAddress document
 * @param {object} chain  { name } from the chain config
 */
function cryptoBlockText(pa, chain) {
  if (!pa || !chain) return "";

  const lines = [];
  lines.push("");
  lines.push(`You can also pay in ${pa.tokenSymbol} on the blockchain.`);
  lines.push("");
  lines.push(`Network: ${chain.name}`);
  lines.push(`Send ${pa.tokenSymbol} ONLY to this address:`);
  lines.push(pa.address);
  lines.push(`Amount to send: ${usdc(pa.expectedUsdc)} ${pa.tokenSymbol}`);
  lines.push(
    `That is the same as ${ngn(pa.invoiceBalanceNgn)} naira, ` +
      `at a rate of ${ngn(pa.ngnPerUsd)} naira to 1 ${pa.tokenSymbol}.`
  );
  lines.push(`This address stops accepting payment on ${expiryWords(pa.expiresAt)}.`);
  lines.push("");
  lines.push(
    `Please be careful. Send ${pa.tokenSymbol} only, and only on the ${chain.name} ` +
      "network. If you send any other coin, or use any other network, the money will " +
      "be lost permanently and nobody can recover it for you."
  );

  return lines.join("\n");
}

/**
 * HTML block for the branded email: a copyable monospace address plus a QR the
 * payer can scan instead of transcribing 42 characters by hand.
 *
 * The QR is referenced by CONTENT ID, not as a `data:` URI. Gmail strips `data:`
 * images outright, so the previous data-URL version simply never appeared for
 * most recipients. `qrCid` must correspond to an inline attachment on the message.
 *
 * @param {object} pa      PaymentAddress document
 * @param {object} chain   { name } from the chain config
 * @param {string|null} qrCid  content id of the attached QR, or null for no QR
 */
function cryptoBlockHtml(pa, chain, qrCid, hasLogo = false) {
  if (!pa || !chain) return "";

  const FONT = "'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,'Courier New',monospace";

  const qr = qrCid
    ? `<tr><td style="padding:4px 18px 18px" align="center">
         <table role="presentation" cellpadding="0" cellspacing="0" border="0">
           <tr><td style="padding:14px;background:#ffffff;border:1px solid #e1e7f0;border-radius:12px" align="center">
             <img src="cid:${qrCid}" width="170" height="170"
                  alt="QR code for the payment address"
                  style="display:block;border:0;width:170px;height:170px" />
           </td></tr>
           <tr><td style="padding-top:8px;font:400 12px ${FONT};color:#64748b" align="center">
             ${
               /* The mark sits beside the caption rather than over the QR
                  itself — anything overlapping the code risks the scan, and the
                  point of the QR is that it reads first time. */
               hasLogo
                 ? `<img src="cid:ledgerwatch-logo" width="14" height="14" alt=""
                         style="display:inline-block;border:0;border-radius:3px;vertical-align:-3px;margin-right:5px" />`
                 : ""
             }Scan with your wallet app
           </td></tr>
         </table>
       </td></tr>`
    : "";

  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
         style="border:1px solid #e1e7f0;border-radius:12px;overflow:hidden">
    <tr>
      <td style="background:#f4f7fa;padding:12px 18px;border-bottom:1px solid #e1e7f0;
                 font:600 13px ${FONT};color:#16294a">
        Or pay in ${pa.tokenSymbol}
      </td>
    </tr>
    <tr>
      <td style="padding:18px 18px 4px">
        <p style="margin:0 0 10px;font:400 14px/1.6 ${FONT};color:#3a4658">
          Send <strong style="color:#0a1428">${pa.tokenSymbol} only</strong>, on the
          <strong style="color:#0a1428">${chain.name}</strong> network, to this address:
        </p>
        <div style="font:600 13px/1.5 ${MONO};word-break:break-all;background:#f4f7fa;
                    border:1px solid #e1e7f0;border-radius:8px;padding:12px 14px;
                    color:#0a1428">${pa.address}</div>

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
               style="margin-top:14px;font:400 14px ${FONT};color:#3a4658">
          <tr>
            <td style="padding:5px 0;border-bottom:1px solid #f1f4f9">Amount to send</td>
            <td style="padding:5px 0;border-bottom:1px solid #f1f4f9;text-align:right;
                       font-weight:700;font-size:16px;color:#0a1428">
              ${usdc(pa.expectedUsdc)} ${pa.tokenSymbol}
            </td>
          </tr>
          <tr>
            <td style="padding:5px 0;border-bottom:1px solid #f1f4f9">Same as</td>
            <td style="padding:5px 0;border-bottom:1px solid #f1f4f9;text-align:right;color:#0a1428">
              &#8358;${ngn(pa.invoiceBalanceNgn)}
            </td>
          </tr>
          <tr>
            <td style="padding:5px 0;border-bottom:1px solid #f1f4f9">Rate used</td>
            <td style="padding:5px 0;border-bottom:1px solid #f1f4f9;text-align:right;color:#0a1428">
              &#8358;${ngn(pa.ngnPerUsd)} to 1 ${pa.tokenSymbol}
            </td>
          </tr>
          <tr>
            <td style="padding:5px 0">Accepts payment until</td>
            <td style="padding:5px 0;text-align:right;color:#0a1428">
              ${expiryWords(pa.expiresAt)}
            </td>
          </tr>
        </table>
      </td>
    </tr>
    ${qr}
    <tr>
      <td style="padding:0 18px 18px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
               style="background:#fbe9e6;border-radius:8px">
          <tr><td style="padding:12px 14px;font:400 13px/1.6 ${FONT};color:#a4302a">
            <strong>Please check before sending.</strong> Send ${pa.tokenSymbol} only, and only on
            the ${chain.name} network. If you send any other coin, or use any other network, the
            money will be lost permanently and nobody can recover it for you.
          </td></tr>
        </table>
      </td>
    </tr>
  </table>`;
}

module.exports = { cryptoBlockText, cryptoBlockHtml };
