import { useEffect, useRef, useState } from "react";
import { Plus, Trash2, Receipt as ReceiptIcon } from "lucide-react";

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

export default function PaymentPanel({ debt, onChange }) {
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [receiptError, setReceiptError] = useState("");

  const currency = debt.currency || "NGN";
  const total = debt.amount || 0;
  const paid = debt.amountPaid || 0;
  const balance = debt.balance != null ? debt.balance : Math.max(0, total - paid);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await http.get(`/api/debts/${debt._id}/payments`);
      setPayments(data.payments);
      setLoadError("");
    } catch (err) {
      setLoadError(
        err?.response?.data?.error ||
          "The payment history for this invoice could not be loaded, so what is shown below may be out of date. This is a connection problem, not a statement that nothing has been paid."
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debt._id]);

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
    setActionError("");
    let data;
    try {
      ({ data } = await http.delete(`/api/debts/${debt._id}/payments/${p._id}`));
    } catch (err) {
      setActionError(
        err?.response?.data?.error ||
          "The payment could not be removed, so the balance is unchanged. Try again."
      );
      return;
    }
    await load();
    if (onChange) onChange(data.debt);
  }

  async function showReceipt() {
    try {
      const { data } = await http.get(`/api/debts/${debt._id}/receipt`);
      setReceipt(data.receipt);
      setReceiptError("");
    } catch (err) {
      setReceipt(null);
      setReceiptError(
        err?.response?.data?.error ||
          "The payment was recorded, but its receipt could not be loaded. Reopen this invoice to try again."
      );
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

      {loadError && <p className="error-text">{loadError}</p>}
      {actionError && <p className="error-text">{actionError}</p>}

      {loading ? (
        <SkeletonLines count={2} />
      ) : payments.length === 0 && !loadError ? (
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
      ) : payments.length === 0 ? null : (
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

      {receiptError && <p className="error-text">{receiptError}</p>}

      {receipt && (
        <div className="stack-sm">
          <span className="overline">Latest receipt</span>
          <ReceiptCard receipt={receipt} />
        </div>
      )}
    </div>
  );
}
