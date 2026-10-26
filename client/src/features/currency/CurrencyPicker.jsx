import { useState } from "react";
import { Select } from "../../components/ui";
import { DISPLAY_CURRENCIES } from "./currencies";
import useDisplayCurrency from "./useDisplayCurrency";

export default function CurrencyPicker({ compact = false, id, label = "Show values in" }) {
  const { wanted, setCurrency } = useDisplayCurrency();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function change(e) {
    const next = e.target.value;
    setBusy(true);
    setError("");
    try {
      await setCurrency(next);
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || "That currency could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className={compact ? "currency-picker compact" : "currency-picker"}>
      <Select
        id={id}
        className="currency-select"
        aria-label={label}
        title={label}
        value={wanted}
        onChange={change}
        disabled={busy}
      >
        {DISPLAY_CURRENCIES.map((c) => (
          <option key={c.code} value={c.code}>
            {compact ? c.code : `${c.code}, ${c.name}`}
          </option>
        ))}
      </Select>
      {error && (
        <span className="error-text currency-picker-error" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
