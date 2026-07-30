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
 * HTML block for the branded email. The address sits in a copyable monospace box,
 * with a QR image the payer can scan instead of copying by hand.
 * @param {string} qrDataUrl  base64 QR of the address, or null
 */
function cryptoBlockHtml(pa, chain, qrDataUrl) {
  if (!pa || !chain) return "";

  const qr = qrDataUrl
    ? `<tr><td style="padding:14px 0 0;text-align:center">
         <img src="${qrDataUrl}" width="168" height="168" alt="Payment address QR code"
              style="border-radius:10px;border:1px solid #e1e7f0" />
       </td></tr>`
    : "";

  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
         style="margin-top:20px;border:1px solid #e1e7f0;border-radius:12px;overflow:hidden">
    <tr>
      <td style="background:#f4f7fa;padding:12px 18px;font:600 13px Inter,Arial,sans-serif;color:#16294a">
        Pay in ${pa.tokenSymbol} &middot; ${chain.name}
        <span style="display:inline-block;margin-left:8px;padding:2px 8px;border-radius:999px;
                     background:#fdf0da;color:#8a5a11;font-size:11px;font-weight:700">TESTNET</span>
      </td>
    </tr>
    <tr>
      <td style="padding:18px">
        <p style="margin:0 0 6px;font:400 14px Inter,Arial,sans-serif;color:#3a4658">
          Send <strong>${pa.tokenSymbol} only</strong>, on the <strong>${chain.name}</strong> network,
          to this address:
        </p>
        <div style="font:600 13px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
                    word-break:break-all;background:#f4f7fa;border:1px solid #e1e7f0;
                    border-radius:8px;padding:12px 14px;color:#0a1428">${pa.address}</div>

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
               style="margin-top:14px;font:400 14px Inter,Arial,sans-serif;color:#3a4658">
          <tr>
            <td style="padding:4px 0">Amount to send</td>
            <td style="padding:4px 0;text-align:right;font-weight:700;color:#0a1428">
              ${usdc(pa.expectedUsdc)} ${pa.tokenSymbol}
            </td>
          </tr>
          <tr>
            <td style="padding:4px 0">Same as</td>
            <td style="padding:4px 0;text-align:right;color:#0a1428">
              ${ngn(pa.invoiceBalanceNgn)} naira
            </td>
          </tr>
          <tr>
            <td style="padding:4px 0">Rate used</td>
            <td style="padding:4px 0;text-align:right;color:#0a1428">
              ${ngn(pa.ngnPerUsd)} naira to 1 ${pa.tokenSymbol}
            </td>
          </tr>
          <tr>
            <td style="padding:4px 0">Accepts payment until</td>
            <td style="padding:4px 0;text-align:right;color:#0a1428">
              ${expiryWords(pa.expiresAt)}
            </td>
          </tr>
        </table>
        ${qr}
        <p style="margin:16px 0 0;padding:12px 14px;border-radius:8px;background:#fbe4e1;
                  font:400 13px Inter,Arial,sans-serif;color:#b3362b;line-height:1.55">
          Please be careful. Send ${pa.tokenSymbol} only, and only on the ${chain.name} network.
          If you send any other coin, or use any other network, the money will be lost
          permanently and nobody can recover it for you.
        </p>
      </td>
    </tr>
  </table>`;
}

module.exports = { cryptoBlockText, cryptoBlockHtml };
