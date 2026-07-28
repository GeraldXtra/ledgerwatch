import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import http from "../../api/http";
import { price as fmtPrice } from "./format";
import { Button, Card, Field, Select, Input } from "../../components/ui";
import CoinPicker from "./CoinPicker";

const TYPES = [
  { value: "drop_pct", label: "Drops by %" },
  { value: "rise_pct", label: "Rises by %" },
  { value: "price_below", label: "Price below" },
  { value: "price_above", label: "Price above" },
];

const isPriceType = (t) => t === "price_below" || t === "price_above";

/**
 * Create a watch on ANY coin: a searchable coin picker (/api/coins/search) plus an
 * inline condition builder. Posts { coinId, symbol, type, value } to /api/watches.
 * onAdded() refreshes the parent.
 */
export default function AddWatchForm({ onAdded }) {
  const [coin, setCoin] = useState(null); // { id, symbol, name }
  const [type, setType] = useState("price_below");
  const [value, setValue] = useState("");
  const [livePrice, setLivePrice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  // Fetch the picked coin's live price as a hint.
  useEffect(() => {
    setLivePrice(null);
    if (!coin) return;
    let active = true;
    http
      .get("/api/markets", { params: { ids: coin.id } })
      .then(({ data }) => {
        if (active) setLivePrice(data.markets?.[0]?.current_price ?? null);
      })
      .catch(() => {});
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
      });
      setOk(`Now watching ${coin.symbol}.`);
      setValue("");
      setCoin(null);
      if (onAdded) onAdded();
    } catch (err) {
      setError(err?.response?.data?.error || "Could not create the watch.");
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
    <Card
      eyebrow="New watch"
      title="Watch a coin"
      subtitle="Search any coin, set a condition, and the agent checks it on every pass."
    >
      <form onSubmit={submit} className="stack-sm">
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
          {isPriceType(type)
            ? "Tip: set Price below above the current price to trigger on the next check."
            : "Measured from the price captured when the watch is created."}
        </p>

        {error && <p className="error-text" style={{ margin: 0 }}>{error}</p>}
        {ok && !error && <p className="muted small" style={{ margin: 0 }}>{ok}</p>}

        <Button variant="primary" type="submit" loading={busy} block>
          <Plus size={15} /> Add watch
        </Button>
      </form>
    </Card>
  );
}
