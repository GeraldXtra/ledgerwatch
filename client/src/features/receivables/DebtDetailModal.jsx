import { Suspense, lazy } from "react";
import { BellRing, Check, Coins, Pencil, Trash2, X } from "lucide-react";
import { Avatar, Button, Modal, StatusPill } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { ngn, shortDate } from "./format";
import PaymentPanel from "./PaymentPanel";

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
}) {
  const { user } = useAuth();
  const currency = debt.currency || "NGN";
  const balance = debt.balance != null ? debt.balance : debt.amount;
  const paid = debt.displayStatus === "paid" || balance <= 0;
  const cryptoEnabled = user?.crypto?.enabled !== false;

  return (
    <Modal label={`Debt for ${debt.debtorName}`} onClose={onClose} size="lg">
      <div className="row space-between coin-detail-head">
        <div className="row">
          <Avatar name={debt.debtorName} size="lg" />
          <div>
            <h3 className="section-title">{debt.debtorName}</h3>
            <div className="muted small num">
              {debt.debtorPhone || "no phone on file"}
              {debt.debtorEmail ? ` · ${debt.debtorEmail}` : ""}
            </div>
          </div>
        </div>
        <div className="row">
          <StatusPill status={debt.displayStatus} />
          <Button variant="ghost" icon title="Close" onClick={onClose}>
            <X size={16} />
          </Button>
        </div>
      </div>

      <div className="row wrap detail-actions no-print">
        <Button onClick={() => onRemind(debt)}>
          <BellRing size={14} /> Generate reminder
        </Button>
        {!paid && onCrypto && cryptoEnabled && (
          <Button onClick={() => onCrypto(debt)}>
            <Coins size={14} /> Crypto payment
          </Button>
        )}
        {!paid && (
          <Button onClick={() => onMarkPaid(debt)}>
            <Check size={14} /> Mark fully paid
          </Button>
        )}
        <Button variant="ghost" onClick={() => onEdit(debt)}>
          <Pencil size={14} /> Edit
        </Button>
        <Button variant="danger" onClick={() => onDelete(debt)}>
          <Trash2 size={14} /> Delete
        </Button>
      </div>

      <div className="detail-stats">
        <div className="detail-stat">
          <span className="overline">Original</span>
          <span className="num mono-strong">{ngn(debt.amount, currency)}</span>
        </div>
        <div className="detail-stat">
          <span className="overline">Paid</span>
          <span className="num mono-strong value-pos">{ngn(debt.amountPaid || 0, currency)}</span>
        </div>
        <div className="detail-stat">
          <span className="overline">Balance</span>
          <span className={`num mono-strong ${balance > 0 ? "value-neg" : "value-pos"}`}>{ngn(balance, currency)}</span>
        </div>
        <div className="detail-stat">
          <span className="overline">Due date</span>
          <span className="num mono-strong">{shortDate(debt.dueDate)}</span>
        </div>
      </div>

      {debt.note && (
        <p className="muted small" style={{ margin: 0 }}>{debt.note}</p>
      )}

      <PaymentPanel debt={debt} onChange={onChanged} />

      <Suspense fallback={null}>
        <CryptoPaymentPanel debt={debt} refreshKey={cryptoKey} />
      </Suspense>
    </Modal>
  );
}
