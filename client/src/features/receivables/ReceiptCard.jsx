import { useState } from "react";
import { Copy, Printer, Check } from "lucide-react";
import { Button } from "../../components/ui";
import { ngn, shortDate, METHOD_LABEL } from "./format";

function receiptText(r) {
  return [
    `PAYMENT RECEIPT`,
    `${r.businessName}`,
    ``,
    `Received from: ${r.debtorName}`,
    `Amount paid: ${ngn(r.amount, r.currency)}`,
    `Method: ${METHOD_LABEL[r.method] || r.method}`,
    `Date: ${shortDate(r.paidAt)}`,
    `Balance remaining: ${ngn(r.balanceRemaining, r.currency)}`,
    ``,
    `Thank you.`,
  ].join("\n");
}

/**
 * Printable receipt card for a payment, with copy-as-text (for WhatsApp) and print.
 */
export default function ReceiptCard({ receipt }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(receiptText(receipt));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <div className="stack-sm">
      <div className="receipt-card printable">
        <div className="receipt-head">
          <span className="overline accent">Payment receipt</span>
          <span className="receipt-biz">{receipt.businessName}</span>
        </div>
        <dl className="receipt-rows">
          <div><dt>Received from</dt><dd>{receipt.debtorName}</dd></div>
          <div><dt>Amount paid</dt><dd className="num mono-strong">{ngn(receipt.amount, receipt.currency)}</dd></div>
          <div><dt>Method</dt><dd>{METHOD_LABEL[receipt.method] || receipt.method}</dd></div>
          <div><dt>Date</dt><dd className="num">{shortDate(receipt.paidAt)}</dd></div>
          <div className="receipt-balance">
            <dt>Balance remaining</dt>
            <dd className={`num mono-strong ${receipt.balanceRemaining > 0 ? "value-neg" : "value-pos"}`}>
              {ngn(receipt.balanceRemaining, receipt.currency)}
            </dd>
          </div>
        </dl>
      </div>
      <div className="row no-print">
        <Button size="sm" onClick={copy}>
          {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy as text"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => window.print()}>
          <Printer size={14} /> Print
        </Button>
      </div>
    </div>
  );
}
