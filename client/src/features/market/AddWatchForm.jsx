import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import http from "../../api/http";
import { price as fmtPrice } from "./format";
import { Button, Field, PageHeader, Select, Input } from "../../components/ui";
import CoinPicker from "./CoinPicker";

const TYPES = [
  { value: "drop_pct", label: "Drops by %" },
  { value: "rise_pct", label: "Rises by %" },
  { value: "price_below", label: "Price below" },
  { value: "price_above", label: "Price above" },
];

const isPriceType = (t) => t === "price_below" || t === "price_above";

export default function AddWatchForm({ onAdded, onCancel, mode }) {
  const [coin, setCoin] = useState(null);
  const [type, setType] = useState("price_below");
  const [value, setValue] = useState("");
  const [livePrice, setLivePrice] = useState(null);
  const [priceNote, setPriceNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  useEffect(() => {
    setLivePrice(null);
    setPriceNote("");
    if (!coin) return;
    let active = true;
    http
      .get("/api/markets", { params: { ids: coin.id } })
      .then(({ data }) => {
        if (!active) return;
        if (!data || !Array.isArray(data.markets)) {
          setPriceNote("Live price unavailable (unexpected response).");
          return;
        }
        const row = data.markets[0];
        if (!row || typeof row.current_price !== "number") {
          setPriceNote("No live price for this coin right now.");
          return;
        }
        setLivePrice(row.current_price);
      })
      .catch((err) => {
        if (!active) return;
        setPriceNote(
          err?.response?.data?.error || "Live price unavailable. You can still set a condition."
        );
      });
    return () => {
      active = false;
    };
  }, [coin]);

  async function submit(e) {
    e.preventDefault();
    setError("");
    setOk("");
    if (!coin) {
      setError("Pick a coin first.");
      return;
    }
    const num = Number(value);
    if (!num || num <= 0) {
      setError("Enter a value greater than 0.");
      return;
    }
    setBusy(true);
    try {
      await http.post("/api/watches", {
        coinId: coin.id,
        symbol: coin.symbol,
        type,
        value: num,
        mode,
      });
      setOk(`Now watching ${coin.symbol}.`);
      setValue("");
      setCoin(null);
      if (onAdded) onAdded();
    } catch (err) {
      const status = err?.response?.status;
      const server = err?.response?.data?.error;
      setError(
        server ||
          (status === 401
            ? "Your session has ended. Sign in again and retry."
            : status === 429
              ? "Too many requests just now. Wait a moment and retry."
              : status
                ? `The server answered ${status}. Try again in a moment.`
                : "No answer from the server. Check your connection and try again.")
      );
    } finally {
      setBusy(false);
    }
  }

  const valueLabel = isPriceType(type) ? "Price (USD)" : "Change (%)";
  const placeholder = isPriceType(type)
    ? livePrice != null
      ? Math.round(livePrice).toString()
      : "e.g. 65000"
    : "e.g. 5";

  return (
    <>
      <PageHeader
        eyebrow="New watch"
        title="Watch a coin"
        support="Search any coin, set a condition, and the agent checks it on every pass."
      />
      <form onSubmit={submit} className="pv-form">
        <section className="card stack">
        <Field label="Coin">
          <CoinPicker value={coin} onChange={setCoin} />
        </Field>

        <div className="grid2">
          <Field label="Condition">
            <Select value={type} onChange={(e) => setType(e.target.value)}>
              {TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={valueLabel}>
            <Input
              type="number"
              min="0"
              step="any"
              inputMode="decimal"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={placeholder}
            />
          </Field>
        </div>

        <p className="muted caption" style={{ margin: 0 }}>
          {coin && livePrice != null ? (
            <>
              {coin.symbol} is{" "}
              <span className="num" style={{ color: "var(--ink)" }}>{fmtPrice(livePrice)}</span> now.{" "}
            </>
          ) : null}
          {type === "price_below"
            ? "Tip: set a value above the current price to trigger on the next check."
            : type === "price_above"
            ? "Tip: set a value below the current price to trigger on the next check."
            : "Measured from the price captured when the watch is created."}
        </p>

        {priceNote && (
          <p className="muted caption" style={{ margin: 0 }}>
            {priceNote}
          </p>
        )}

        {error && <p className="error-text" style={{ margin: 0 }}>{error}</p>}
        {ok && !error && <p className="muted small" style={{ margin: 0 }}>{ok}</p>}
        </section>

        <div className="pv-foot">
          {onCancel && (
            <Button variant="ghost" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
          )}
          <Button variant="primary" type="submit" loading={busy}>
            <Plus size={15} /> Add watch
          </Button>
        </div>
      </form>
    </>
  );
}
