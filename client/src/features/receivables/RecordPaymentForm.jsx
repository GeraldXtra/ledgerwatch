import { useState } from "react";
import { Button, Field, Input, Select } from "../../components/ui";
import { ngn } from "./format";

/**
 * Record a payment against a debt. Prefills the amount with the outstanding
 * balance. onSubmit({ amount, method, note, paidAt }) should POST the payment.
 */
export default function RecordPaymentForm({ balance, currency, onSubmit, onCancel }) {
  const [amount, setAmount] = useState(balance ? String(balance) : "");
  const [method, setMethod] = useState("transfer");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    setError("");
    const amt = Number(amount);
    if (!amt || amt <= 0) {
      setError("Enter an amount greater than 0.");
      return;
    }
    if (amt > balance) {
      setError(`That is more than the ${ngn(balance, currency)} outstanding.`);
      return;
    }
    setBusy(true);
    try {
      await onSubmit({ amount: amt, method, note: note || undefined });
    } catch (err) {
      setError(err?.response?.data?.error || "Could not record the payment.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="stack-sm">
      <div className="grid2">
        <Field label={`Amount (outstanding ${ngn(balance, currency)})`}>
          <Input
            type="number"
            min="0"
            step="any"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            autoFocus
          />
        </Field>
        <Field label="Method">
          <Select value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="transfer">Transfer</option>
            <option value="cash">Cash</option>
            <option value="other">Other</option>
          </Select>
        </Field>
      </div>
      <Field label="Note (optional)">
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. part payment" />
      </Field>
      {error && <p className="error-text" style={{ margin: 0 }}>{error}</p>}
      <div className="row" style={{ justifyContent: "flex-end" }}>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        )}
        <Button variant="primary" type="submit" loading={busy}>
          Record payment
        </Button>
      </div>
    </form>
  );
}
