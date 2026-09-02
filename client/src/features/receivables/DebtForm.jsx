import { useEffect, useRef, useState } from "react";
import { ShieldAlert } from "lucide-react";
import http from "../../api/http";
import { Button, Field, Input } from "../../components/ui";
import ReliabilityBadge from "./ReliabilityBadge";
import { compactNgn } from "./format";

/** Group the integer part with thousand separators while preserving what the
 *  user is mid-way through typing (including a trailing decimal point). */
function groupDigits(raw) {
  const s = String(raw ?? "");
  if (!s) return "";
  const [intPart, ...rest] = s.split(".");
  const grouped = intPart ? Number(intPart).toLocaleString("en-NG") : "";
  return rest.length ? `${grouped}.${rest.join("")}` : grouped;
}

const EMPTY = {
  debtorName: "",
  debtorPhone: "",
  debtorEmail: "",
  amount: "",
  dueDate: "",
  note: "",
  reminderCadenceDays: "",
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function toDateInput(value) {
  if (!value) return "";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

/**
 * Add/edit debt form (rendered inside a Modal by the parent). When `initial`
 * is provided the form is in edit mode. onSubmit(payload) returns a promise;
 * onCancel closes the modal.
 */
export default function DebtForm({ initial, onSubmit, onCancel }) {
  const editing = Boolean(initial);
  const [form, setForm] = useState(
    editing
      ? {
          debtorName: initial.debtorName || "",
          debtorPhone: initial.debtorPhone || "",
          debtorEmail: initial.debtorEmail || "",
          amount: initial.amount ?? "",
          dueDate: toDateInput(initial.dueDate),
          note: initial.note || "",
          reminderCadenceDays: initial.reminderCadenceDays ?? "",
        }
      : EMPTY
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [known, setKnown] = useState(null); // matched existing debtor (reliability warning)
  const lookupRef = useRef(null);

  const update = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // Debounced lookup: when the phone matches an existing debtor, surface their
  // reliability so the owner sees the risk before recording a new debt.
  useEffect(() => {
    if (editing) return;
    clearTimeout(lookupRef.current);
    const phone = form.debtorPhone.trim();
    if (phone.length < 6) {
      setKnown(null);
      return;
    }
    lookupRef.current = setTimeout(async () => {
      try {
        const { data } = await http.get("/api/debtors/lookup", { params: { phone } });
        setKnown(data.debtor || null);
      } catch {
        setKnown(null);
      }
    }, 400);
    return () => clearTimeout(lookupRef.current);
  }, [form.debtorPhone, editing]);

  async function submit(e) {
    e.preventDefault();
    setError("");

    const email = form.debtorEmail.trim();
    if (email && !EMAIL_REGEX.test(email)) {
      setError("Enter a valid email address, or leave it blank.");
      return;
    }

    setBusy(true);
    try {
      const payload = {
        debtorName: form.debtorName,
        debtorPhone: form.debtorPhone || undefined,
        debtorEmail: email || undefined,
        amount: Number(form.amount),
        dueDate: form.dueDate,
        note: form.note || undefined,
      };
      if (form.reminderCadenceDays !== "") {
        payload.reminderCadenceDays = Number(form.reminderCadenceDays);
      }
      await onSubmit(payload);
      if (!editing) setForm(EMPTY);
    } catch (err) {
      setError(err?.response?.data?.error || "Failed to save debt");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div>
        <h3 className="section-title">{editing ? "Edit debt" : "Record a debt"}</h3>
        <p className="muted small" style={{ margin: "4px 0 0" }}>
          {editing
            ? "Update the details of this receivable."
            : "Track a credit sale. LedgerWatch drafts the reminders for you."}
        </p>
      </div>

      <form onSubmit={submit} className="stack">
        <div className="grid2">
          <Field label="Debtor name">
            <Input value={form.debtorName} onChange={update("debtorName")} required autoFocus />
          </Field>
          <Field label="Phone (for example 08031234567)">
            <Input value={form.debtorPhone} onChange={update("debtorPhone")} />
          </Field>
          <Field label="Email (optional, turns on email reminders)">
            <Input
              type="email"
              value={form.debtorEmail}
              onChange={update("debtorEmail")}
              placeholder="name@example.com"
            />
          </Field>
          <Field label="Amount (₦)">
            {/* Text rather than number so thousand separators can be shown while
                typing, because enterprise invoices run to nine figures and an unbroken
                run of digits is unreadable. The raw numeric string is kept in
                state; only the display is grouped. */}
            <Input
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={groupDigits(form.amount)}
              onChange={(e) =>
                setForm((f) => ({ ...f, amount: e.target.value.replace(/[^\d.]/g, "") }))
              }
              placeholder="0"
              required
            />
            {Number(form.amount) >= 1e6 && (
              <span className="field-hint num">{compactNgn(Number(form.amount))}</span>
            )}
          </Field>
          <Field label="Due date">
            <Input type="date" value={form.dueDate} onChange={update("dueDate")} required />
          </Field>
          <Field label="Re-remind every (days)">
            <Input
              type="number"
              min="1"
              value={form.reminderCadenceDays}
              onChange={update("reminderCadenceDays")}
              placeholder="3"
            />
          </Field>
          <Field label="Note (optional)">
            <Input value={form.note} onChange={update("note")} />
          </Field>
        </div>

        {known && known.reliabilityScore != null && (known.band === "Risky" || known.band === "Fair") && (
          <div className="rel-warning">
            <span className="rel-warning-icon"><ShieldAlert size={16} /></span>
            <div className="grow">
              <div className="rel-warning-title">
                {known.debtorName} has a {known.band.toLowerCase()} payment record.
              </div>
              <div className="muted small">
                {known.onTimeRate != null
                  ? `On-time ${Math.round(known.onTimeRate * 100)}% of the time`
                  : "Limited history"}
                {known.totalOutstanding > 0 ? ` · already owes ${(known.totalOutstanding).toLocaleString("en-NG")} NGN` : ""}.
              </div>
            </div>
            <ReliabilityBadge score={known.reliabilityScore} band={known.band} size="sm" />
          </div>
        )}
        {known && known.reliabilityScore != null && (known.band === "Excellent" || known.band === "Good") && (
          <div className="rel-note">
            Returning customer. {known.debtorName} usually pays reliably.
            <ReliabilityBadge score={known.reliabilityScore} band={known.band} size="sm" />
          </div>
        )}

        {error && <p className="error-text">{error}</p>}

        <div className="row" style={{ justifyContent: "flex-end" }}>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={busy}>
            {busy ? "Saving..." : editing ? "Save changes" : "Add debt"}
          </Button>
        </div>
      </form>
    </div>
  );
}
