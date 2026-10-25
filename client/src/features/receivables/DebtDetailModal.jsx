import { Suspense, lazy } from "react";
import { BellRing, Check, Coins, Pencil, Trash2, X } from "lucide-react";
import { Button, Card, Modal, PageHeader, StatusPill } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { ngn, shortDate } from "./format";
import PaymentPanel, { PaymentSummary } from "./PaymentPanel";
import ReminderPanel from "./ReminderPanel";
import InvoiceCard from "./InvoiceCard";

const CryptoPaymentPanel = lazy(() => import("./CryptoPaymentPanel"));

export default function DebtDetailModal({
  debt,
  onClose,
  onRemind,
  onMarkPaid,
  onEdit,
  onDelete,
  onChanged,
  onCrypto,
  cryptoKey = 0,
  reminder = null,
  onCloseReminder,
}) {
  const { user } = useAuth();
  const currency = debt.currency || "NGN";
  const balance = debt.balance != null ? debt.balance : debt.amount;
  const paid = debt.displayStatus === "paid" || balance <= 0;
  const cryptoEnabled = user?.crypto?.enabled !== false;

  return (
    <Modal
      label={`Debt for ${debt.debtorName}`}
      view="debt"
      crumb={debt.debtorName}
      onClose={onClose}
      size="lg"
    >
      <PageHeader
        title={debt.debtorName}
        support={
          <span className="row tight">
            {debt.invoiceNumber && <span className="muted small num">{debt.invoiceNumber}</span>}
            <StatusPill status={debt.displayStatus} />
          </span>
        }
        action={
          <div className="row wrap detail-actions no-print">
            <Button variant="danger" onClick={() => onDelete(debt)}>
              <Trash2 size={14} /> Delete
            </Button>
            <Button onClick={() => onEdit(debt)}>
              <Pencil size={14} /> Edit
            </Button>
            {!paid && (
              <Button onClick={() => onMarkPaid(debt)}>
                <Check size={14} /> Mark fully paid
              </Button>
            )}
            {!paid && onCrypto && cryptoEnabled && (
              <Button onClick={() => onCrypto(debt)}>
                <Coins size={14} /> Crypto payment
              </Button>
            )}
            <Button variant="primary" onClick={() => onRemind(debt)}>
              <BellRing size={14} /> Generate reminder
            </Button>
            <Button variant="ghost" icon title="Close" onClick={onClose}>
              <X size={16} />
            </Button>
          </div>
        }
      />

      <Card title="Details">
        <div className="stack">
          <div className="detail-stats">
            <div className="detail-stat">
              <span className="overline">Phone</span>
              <span className="num">{debt.debtorPhone || "no phone on file"}</span>
            </div>
            {debt.debtorEmail && (
              <div className="detail-stat">
                <span className="overline">Email</span>
                <span>{debt.debtorEmail}</span>
              </div>
            )}
            <div className="detail-stat">
              <span className="overline">Original</span>
              <span className="num">{ngn(debt.amount, currency)}</span>
            </div>
            <div className="detail-stat">
              <span className="overline">Paid</span>
              <span className="num value-pos">{ngn(debt.amountPaid || 0, currency)}</span>
            </div>
            <div className="detail-stat">
              <span className="overline">Balance</span>
              <span className={`num ${balance > 0 ? "value-neg" : "value-pos"}`}>
                {ngn(balance, currency)}
              </span>
            </div>
            <div className="detail-stat">
              <span className="overline">Due date</span>
              <span className="num">{shortDate(debt.dueDate)}</span>
            </div>
            {debt.note && (
              <div className="detail-stat">
                <span className="overline">Note</span>
                <span>{debt.note}</span>
              </div>
            )}
            <div className="detail-stat">
              <span className="overline">Status</span>
              <span>
                <StatusPill status={debt.displayStatus} />
              </span>
            </div>
          </div>
          <PaymentSummary debt={debt} />
        </div>
      </Card>

      {reminder && (
        <ReminderPanel
          debt={debt}
          result={reminder.result}
          onClose={onCloseReminder}
          inline
        />
      )}

      <InvoiceCard debt={debt} />

      <PaymentPanel debt={debt} onChange={onChanged} />

      <Suspense fallback={null}>
        <CryptoPaymentPanel debt={debt} refreshKey={cryptoKey} />
      </Suspense>
    </Modal>
  );
}
