import { Download, Printer, X } from "lucide-react";
import { Button, Modal, StatusPill } from "../../components/ui";
import { ngn, shortDate, dateTime, METHOD_LABEL } from "./format";
import { downloadCsv } from "./csv";

/**
 * Printable statement of all a debtor's debts + payments, with CSV export.
 */
export default function DebtorStatement({ statement, onClose }) {
  const { businessName, debtor, debts, totals, generatedAt } = statement;

  function exportCsv() {
    const rows = [];
    for (const d of debts) {
      rows.push(["Debt", shortDate(d.createdAt), d.note || "", d.amount, "", d.balance, d.displayStatus]);
      for (const p of d.payments) {
        rows.push(["Payment", shortDate(p.paidAt), METHOD_LABEL[p.method] || p.method, "", p.amount, "", ""]);
      }
    }
    downloadCsv(
      `statement-${(debtor.debtorName || "debtor").replace(/\s+/g, "-").toLowerCase()}.csv`,
      ["Type", "Date", "Detail", "Amount", "Paid", "Balance", "Status"],
      rows
    );
  }

  return (
    <Modal label={`Statement for ${debtor.debtorName}`} onClose={onClose} size="lg">
      <div className="row space-between no-print">
        <h3 className="section-title">Statement</h3>
        <div className="row">
          <Button size="sm" onClick={exportCsv}><Download size={14} /> CSV</Button>
          <Button size="sm" variant="ghost" onClick={() => window.print()}><Printer size={14} /> Print</Button>
          <Button variant="ghost" icon title="Close" onClick={onClose}><X size={16} /></Button>
        </div>
      </div>

      <div className="statement printable">
        <div className="statement-head">
          <div>
            <div className="statement-biz">{businessName}</div>
            <div className="muted small">Customer statement</div>
          </div>
          <div className="statement-meta">
            <div className="mono-strong">{debtor.debtorName}</div>
            <div className="muted small num">{debtor.debtorPhone || ""}</div>
            <div className="muted caption num">Generated {shortDate(generatedAt)}</div>
          </div>
        </div>

        {debts.map((d) => (
          <div key={d._id} className="statement-debt">
            <div className="row space-between">
              <span className="mono-strong">{d.note || "Debt"}</span>
              <StatusPill status={d.displayStatus} />
            </div>
            <div className="muted caption num">
              Recorded {shortDate(d.createdAt)} · due {shortDate(d.dueDate)} · {ngn(d.amount)}
            </div>
            {d.payments.length > 0 && (
              <ul className="statement-payments">
                {d.payments.map((p) => (
                  <li key={p._id} className="row space-between">
                    <span className="muted small">{dateTime(p.paidAt)} · {METHOD_LABEL[p.method] || p.method}</span>
                    <span className="num value-pos">{ngn(p.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="row space-between statement-debt-foot">
              <span className="muted small">Balance</span>
              <span className={`num mono-strong ${d.balance > 0 ? "value-neg" : "value-pos"}`}>{ngn(d.balance)}</span>
            </div>
          </div>
        ))}

        <div className="statement-totals">
          <div className="row space-between"><span className="muted small">Total invoiced</span><span className="num mono-strong">{ngn(totals.totalBorrowed)}</span></div>
          <div className="row space-between"><span className="muted small">Total paid</span><span className="num mono-strong value-pos">{ngn(totals.totalPaid)}</span></div>
          <div className="row space-between statement-grand"><span>Outstanding</span><span className={`num mono-strong ${totals.totalOutstanding > 0 ? "value-neg" : "value-pos"}`}>{ngn(totals.totalOutstanding)}</span></div>
        </div>
      </div>
    </Modal>
  );
}
