import { useState } from "react";
import { Button, Select, Input } from "../../components/ui";

const TYPES = [
  { value: "drop_pct", label: "Drops by %" },
  { value: "rise_pct", label: "Rises by %" },
  { value: "price_below", label: "Price below" },
  { value: "price_above", label: "Price above" },
];

/**
 * Inline editor for a watch condition (type + value). Calls onSave({type,value})
 * which should PATCH the watch. Used in the detail modal and the watch list.
 */
export default function WatchEditRow({ watch, onSave, onCancel }) {
  const [type, setType] = useState(watch.condition.type);
  const [value, setValue] = useState(String(watch.condition.value));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    const num = Number(value);
    if (!num || num <= 0) {
      setError("Enter a value greater than 0.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onSave({ type, value: num });
    } catch (err) {
      setError(err?.response?.data?.error || "Could not update the watch.");
      setBusy(false);
    }
  }

  return (
    <div className="watch-edit stack-sm">
      <div className="row wrap" style={{ gap: 8 }}>
        <Select value={type} onChange={(e) => setType(e.target.value)} aria-label="Condition type">
          {TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Select>
        <Input
          type="number"
          min="0"
          step="any"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label="Condition value"
          style={{ maxWidth: 120 }}
        />
        <Button variant="primary" size="sm" onClick={save} loading={busy}>
          Save
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
      {error && <p className="error-text" style={{ margin: 0 }}>{error}</p>}
    </div>
  );
}
