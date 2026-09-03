import { useEffect, useRef, useState } from "react";
import { Plus, Trash2, Receipt as ReceiptIcon } from "lucide-react";

/** A key the server can use to record this payment exactly once. */
function newIdempotencyKey() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().replace(/-/g, "");
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}
import http from "../../api/http";
import { Button, EmptyState, SkeletonLines } from "../../components/ui";
import { ngn, dateTime, METHOD_LABEL } from "./format";
import ProgressBar from "./ProgressBar";
import RecordPaymentForm from "./RecordPaymentForm";
import ReceiptCard from "./ReceiptCard";

/**
 * Payment panel for one debt: progress bar (paid vs outstanding), payment history,
 * a "Record payment" form, and a receipt for the latest payment. `debt` carries the
 * derived amountPaid/balance. `onChange(updatedDebt)` bubbles status changes up.
 */
export default function PaymentPanel({ debt, onChange }) {
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [receipt, setReceipt] = useState(null);

  const currency = debt.currency || "NGN";
  const total = debt.amount || 0;
  const paid = debt.amountPaid || 0;
  const balance = debt.balance != null ? debt.balance : Math.max(0, total - paid);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await http.get(`/api/debts/${debt._id}/payments`);
      setPayments(data.payments);
    } catch {
      setPayments([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debt._id]);

  /**
   * ONE KEY PER PENDING PAYMENT. Minted on the first submit and kept until the
   * server confirms, so a double tap, a retry after a lost response, or a
   * second click while the first is in flight all carry the same key and the
   * server records the payment once. Cleared on success so the next payment
   * gets its own.
   */
  const pendingKey = useRef(null);

  async function record(payload) {
    if (!pendingKey.current) pendingKey.current = newIdempotencyKey();
    const { data } = await http.post(`/api/debts/${debt._id}/payments`, {
      ...payload,
      idempotencyKey: pendingKey.current,
    });
    pendingKey.current = null;
    setAdding(false);
    await load();
    await showReceipt();
    if (onChange) onChange(data.debt);
  }

  async function removePayment(p) {
    if (!window.confirm(`Remove this ${ngn(p.amount, currency)} payment?`)) return;
    const { data } = await http.delete(`/api/debts/${debt._id}/payments/${p._id}`);
    await load();
    if (onChange) onChange(data.debt);
  }

  async function showReceipt() {
    try {
      const { data } = await http.get(`/api/debts/${debt._id}/receipt`);
      setReceipt(data.receipt);
    } catch {
      setReceipt(null);
    }
  }

  return (
    <div className="stack">
      <div className="payment-summary">
        <div className="row space-between">
          <span className="overline">Paid {ngn(paid, currency)} of {ngn(total, currency)}</span>
          <span className={`num mono-strong ${balance > 0 ? "value-neg" : "value-pos"}`}>
            {balance > 0 ? `${ngn(balance, currency)} outstanding` : "Fully paid"}
          </span>
        </div>
        <ProgressBar paid={paid} total={total} />
      </div>

      <div className="row space-between">
        <span className="overline">Payment history</span>
        {balance > 0 && !adding && (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus size={14} /> Record payment
          </Button>
        )}
      </div>

      {adding && (
        <RecordPaymentForm
          balance={balance}
          currency={currency}
          onSubmit={record}
          onCancel={() => setAdding(false)}
        />
      )}

      {loading ? (
        <SkeletonLines count={2} />
      ) : payments.length === 0 ? (
        <EmptyState
          icon={<ReceiptIcon size={20} />}
          title="No payments yet"
          hint="Record a full or part payment and the balance updates instantly."
          action={
            balance > 0 && !adding ? (
              <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
                Record payment
              </button>
            ) : null
          }
        />
      ) : (
        <ul className="plain-list">
          {payments.map((p) => (
            <li key={p._id} className="row space-between list-row">
              <div>
                <div className="num mono-strong">{ngn(p.amount, currency)}</div>
                <div className="muted caption">
                  {METHOD_LABEL[p.method] || p.method} · {dateTime(p.paidAt)}
                  {p.note ? ` · ${p.note}` : ""}
                </div>
              </div>
              <Button variant="ghost" size="sm" icon title="Remove payment" onClick={() => removePayment(p)}>
                <Trash2 size={13} />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {receipt && (
        <div className="stack-sm">
          <span className="overline">Latest receipt</span>
          <ReceiptCard receipt={receipt} />
        </div>
      )}
    </div>
  );
}
