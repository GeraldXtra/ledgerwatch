import { useState } from "react";
import { Button, Field, Input, useToast } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";

/**
 * Bank details shown inside every payment reminder. Moved here from the old
 * dashboard modal — same fields, same PATCH /api/auth/me call.
 */
export default function PayoutSection() {
  const { user, updateProfile } = useAuth();
  const toast = useToast();
  const bd = user.bankDetails || {};
  const [form, setForm] = useState({
    accountName: bd.accountName || "",
    accountNumber: bd.accountNumber || "",
    bankName: bd.bankName || "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const update = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await updateProfile({ bankDetails: form });
      toast("Payout details saved.", { type: "success" });
    } catch (err) {
      setError(err?.response?.data?.error || "Could not save payout details");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="settings-head">
        <h2 className="section-title">Payout details</h2>
        <p className="muted small">
          These appear inside every reminder so clients know exactly where to pay.
        </p>
      </div>

      <form className="stack" onSubmit={save}>
        <div className="grid2">
          <Field label="Account name">
            <Input value={form.accountName} onChange={update("accountName")} />
          </Field>
          <Field label="Account number">
            <Input
              value={form.accountNumber}
              onChange={update("accountNumber")}
              inputMode="numeric"
            />
          </Field>
          <Field label="Bank name">
            <Input value={form.bankName} onChange={update("bankName")} />
          </Field>
        </div>
        {error && <p className="error-text">{error}</p>}
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <Button variant="primary" type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save payout details"}
          </Button>
        </div>
      </form>
    </div>
  );
}
