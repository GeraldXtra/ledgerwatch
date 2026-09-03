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
 *
 * DELIBERATELY INDEPENDENT OF TRADING MODE.
 * Watching a coin is not trading it. Nothing here consults paper/live mode, the
 * selected chain, the wallet, or whether a tradeable pair exists — a coin with
 * no pool on the current chain is still perfectly watchable, it is simply
 * paper-only for execution, which the trade path already labels. Adding a gate
 * here would silently make watching depend on wallet state it has no business
 * caring about.
 */
export default function AddWatchForm({ onAdded }) {
  const [coin, setCoin] = useState(null); // { id, symbol, name }
  const [type, setType] = useState("price_below");
  const [value, setValue] = useState("");
  const [livePrice, setLivePrice] = useState(null);
  // Why the price hint is missing, when it is. Separate from `error`, which is
  // about the watch itself — a missing hint must never look like a failure to
  // create the watch.
  const [priceNote, setPriceNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  /**
   * The picked coin's live price, as a HINT only.
   *
   * This never gates selection or submission: the watch is created from
   * coinId/symbol/type/value, none of which come from here. A failure states
   * that the hint is unavailable and leaves the form fully usable.
   */
  useEffect(() => {
    setLivePrice(null);
    setPriceNote("");
    if (!coin) return;
    let active = true;
    http
      .get("/api/markets", { params: { ids: coin.id } })
      .then(({ data }) => {
        if (!active) return;
        // Explicit shape check rather than an optional chain that quietly
        // yields undefined. If the server ever changes this response, we say so
        // instead of silently showing no price forever.
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
      });
      setOk(`Now watching ${coin.symbol}.`);
      setValue("");
      setCoin(null);
      if (onAdded) onAdded();
    } catch (err) {
      // Say WHICH failure. A bare "could not create" gave the owner nothing to
      // act on when the real cause was a signed-out session, a rate limit, or
      // no network at all.
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

        {/* The hint failed, the form did not. Said out loud rather than leaving
            an empty space that reads as "nothing is happening". */}
        {priceNote && (
          <p className="muted caption" style={{ margin: 0 }}>
            {priceNote}
          </p>
        )}

        {error && <p className="error-text" style={{ margin: 0 }}>{error}</p>}
        {ok && !error && <p className="muted small" style={{ margin: 0 }}>{ok}</p>}

        <Button variant="primary" type="submit" loading={busy} block>
          <Plus size={15} /> Add watch
        </Button>
      </form>
    </Card>
  );
}
