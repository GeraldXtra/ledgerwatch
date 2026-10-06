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
  /**
   * "WE COULD NOT ASK" IS NOT "THERE IS NONE" (LW-029).
   *
   * A failed history load used to `setPayments([])`, and an empty list renders
   * the friendly "No payments yet" panel. Those are two different claims about
   * the world. The owner opens an invoice while the connection is down, with the
   * customer on the phone querying their balance, and the screen tells them that
   * customer has never paid anything. The list is now left ALONE on a failure
   * and the failure is stated, so nothing is ever asserted about money that was
   * not actually read back.
   */
  const [loadError, setLoadError] = useState("");
  // Failures from removing a payment and from fetching the receipt. Both changed
  // or reported what is owed and both used to fail in silence.
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
    setActionError("");
    let data;
    try {
      ({ data } = await http.delete(`/api/debts/${debt._id}/payments/${p._id}`));
    } catch (err) {
      // This had no catch at all. A failed delete produced an unhandled
      // rejection in a console nobody watches, the row stayed on screen, and
      // the owner pressed the button again believing the first press did
      // nothing. Removing a payment changes what is owed, so a silent failure
      // leaves them acting on a balance they think they corrected.
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
      // The payment itself is recorded by this point — only the receipt failed
      // to arrive. Said out loud rather than leaving the panel to look as though
      // no receipt exists for a payment that was just taken.
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
        /* Guarded on `loadError`: "No payments yet" is a claim about this
           invoice, and it may only be made when the history was actually read
           back. When it was not, the message above says so instead. */
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
