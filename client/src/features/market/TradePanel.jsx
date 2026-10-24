import { useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, Lightbulb } from "lucide-react";
import { Button, Field, Input, Modal, PageHeader } from "../../components/ui";
import { usd, price as fmtPrice } from "./format";

const QUICK = [0.25, 0.5, 0.75, 1];

export default function TradePanel({
  side,
  alert,
  portfolio,
  onClose,
  onSubmit,
  busyLabel,
  currentPrice,
}) {
  const alertPrice = Number(alert.priceAtAlert) || 0;
  const livePrice = Number(currentPrice) || 0;
  const price = livePrice > 0 ? livePrice : alertPrice;
  const moved =
    livePrice > 0 && alertPrice > 0
      ? ((livePrice - alertPrice) / alertPrice) * 100
      : 0;
  const holding = (portfolio?.holdings || []).find((h) => h.coinId === alert.coinId);
  const heldQty = holding ? holding.qty : 0;

  const cashKnown = Number.isFinite(Number(portfolio?.cashBalance));
  const cash = cashKnown ? Number(portfolio.cashBalance) : null;
  const cashLabel = cashKnown ? usd(cash) : "could not be read";

  const maxQuote = side === "buy" ? cash || 0 : heldQty * price;
  const maxToken = side === "buy" ? (price > 0 ? (cash || 0) / price : 0) : heldQty;

  const [denom, setDenom] = useState(side === "buy" ? "quote" : "token");
  const [raw, setRaw] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const amount = Number(raw) || 0;
  const max = denom === "quote" ? maxQuote : maxToken;

  const quote = useMemo(() => {
    const qty = denom === "quote" ? (price > 0 ? amount / price : 0) : amount;
    const value = denom === "quote" ? amount : amount * price;
    return {
      qty,
      value,
      cashAfter: cash == null ? null : side === "buy" ? cash - value : cash + value,
      positionAfter: side === "buy" ? heldQty + qty : heldQty - qty,
    };
  }, [amount, denom, price, side, cash, heldQty]);

  const tooBig = amount > max + 1e-9;
  const invalid = amount <= 0 || tooBig;

  const validationMessage = !raw
    ? ""
    : amount <= 0
    ? "Enter an amount greater than zero."
    : tooBig
    ? side === "buy"
      ? cashKnown
        ? `That is more than your available cash (${usd(cash)}).`
        : `Your ${portfolio?.cashSymbol || "dollar"} balance on this network could not be read, so ` +
          `what you can spend is not known. That is a connection problem rather than an empty ` +
          `wallet, and your funds are unaffected. Refresh Live positions and try again.`
      : `You only hold ${heldQty.toFixed(6)} ${alert.symbol}.`
    : "";

  function setPct(p) {
    const v = max * p;
    setRaw(denom === "quote" ? v.toFixed(2) : String(Number(v.toFixed(8))));
    setError("");
  }

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const result = await onSubmit({ action: side, amount, denom });
      if (result && result.ok === false) {
        setError(result.message || "That trade could not be completed");
        setConfirming(false);
      }
    } catch (err) {
      setError(err?.response?.data?.error || "That trade could not be completed");
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  const wentAgainst = alert.suggestion !== "hold" && alert.suggestion !== side;

  const title = `${side === "buy" ? "Buy" : "Sell"} ${alert.symbol}`;

  return (
    <Modal
      label={title}
      view={side}
      params={{ step: confirming ? 2 : 1 }}
      crumb={title}
      onClose={onClose}
    >
      <div className="wiz">
        <ol className="wiz-steps">
          <li aria-current={confirming ? undefined : "step"} className={confirming ? "done" : undefined}>
            <small>Step 1</small>
            <b>Amount to spend</b>
          </li>
          <li aria-current={confirming ? "step" : undefined}>
            <small>Step 2</small>
            <b>Confirm this {side}</b>
          </li>
        </ol>

        <div className="wiz-main">
          {!confirming ? (
            <PageHeader
              title={
                <>
                  {side === "buy" ? "Buy" : "Sell"} {alert.symbol}
                </>
              }
              support={<span className="num">{fmtPrice(price)}</span>}
            />
          ) : (
            <PageHeader title={<>Confirm this {side}</>} support="Nothing executes until you confirm." />
          )}

          {Math.abs(moved) >= 0.5 && (
            <div className="against-note">
              {alert.symbol} has moved {moved > 0 ? "up" : "down"} {Math.abs(moved).toFixed(1)}% since
              this alert was raised, from {fmtPrice(alertPrice)} to {fmtPrice(livePrice)}. The amounts below use
              the price now.
            </div>
          )}

          <div className="agent-reasoning">
            <span className="icon-tile neutral">
              <Lightbulb size={16} />
            </span>
            <div className="grow">
              <div className="overline">Agent recommendation: {alert.suggestion}</div>
              <p className="muted small" style={{ margin: "4px 0 0" }}>
                {alert.message}
              </p>
            </div>
          </div>

          {wentAgainst && (
            <div className="against-note">
              <AlertTriangle size={15} />
              <span>
                You are choosing to <strong>{side}</strong> while the agent suggested{" "}
                <strong>{alert.suggestion}</strong>. That is your call, and it will be recorded.
              </span>
            </div>
          )}

          {!confirming ? (
            <>
              <section className="card stack">
              <div className="seg" role="tablist" style={{ maxWidth: 260 }}>
                <button
                  type="button"
                  className={denom === "token" ? "seg-btn active" : "seg-btn"}
                  onClick={() => {
                    setDenom("token");
                    setRaw("");
                  }}
                >
                  {alert.symbol} amount
                </button>
                <button
                  type="button"
                  className={denom === "quote" ? "seg-btn active" : "seg-btn"}
                  onClick={() => {
                    setDenom("quote");
                    setRaw("");
                  }}
                >
                  USD value
                </button>
              </div>

              <Field label={denom === "quote" ? "Amount to spend (USD)" : `Amount (${alert.symbol})`}>
                <Input
                  type="number"
                  min="0"
                  step="any"
                  value={raw}
                  onChange={(e) => setRaw(e.target.value)}
                  placeholder="0"
                  autoFocus
                />
              </Field>

              <div className="row wrap">
                {QUICK.map((p) => (
                  <Button key={p} size="sm" onClick={() => setPct(p)}>
                    {p === 1 ? "MAX" : `${p * 100}%`}
                  </Button>
                ))}
                <span className="muted small" style={{ marginLeft: "auto" }}>
                  Available:{" "}
                  <span className="num">
                    {side === "buy" ? cashLabel : `${heldQty.toFixed(6)} ${alert.symbol}`}
                  </span>
                </span>
              </div>

              {validationMessage && <p className="error-text">{validationMessage}</p>}

              {amount > 0 && !tooBig && (
                <dl className="trade-quote">
                  <div>
                    <dt>You {side === "buy" ? "spend" : "sell"}</dt>
                    <dd className="num">
                      {denom === "quote" ? usd(quote.value) : `${quote.qty.toFixed(8)} ${alert.symbol}`}
                    </dd>
                  </div>
                  <div>
                    <dt>You receive</dt>
                    <dd className="num">
                      {side === "buy" ? `${quote.qty.toFixed(8)} ${alert.symbol}` : usd(quote.value)}
                    </dd>
                  </div>
                  <div>
                    <dt>Price</dt>
                    <dd className="num">{fmtPrice(price)}</dd>
                  </div>
                  <div>
                    <dt>Cash after</dt>
                    <dd className="num">
                      {quote.cashAfter != null ? usd(quote.cashAfter) : "not known"}
                    </dd>
                  </div>
                  <div>
                    <dt>{alert.symbol} position after</dt>
                    <dd className="num">{quote.positionAfter.toFixed(8)}</dd>
                  </div>
                </dl>
              )}

              {error && <p className="error-text">{error}</p>}

              </section>

              <div className="pv-foot">
                <Button variant="ghost" onClick={onClose}>
                  Cancel
                </Button>
                <Button variant="primary" disabled={invalid} onClick={() => setConfirming(true)}>
                  Review {side}
                </Button>
              </div>
            </>
          ) : (
            <>
              <section className="card stack">
              <dl className="trade-quote">
                <div>
                  <dt>Action</dt>
                  <dd>
                    {side === "buy" ? "Buy" : "Sell"} {alert.symbol}
                  </dd>
                </div>
                <div>
                  <dt>Amount</dt>
                  <dd className="num">
                    {quote.qty.toFixed(8)} {alert.symbol}
                  </dd>
                </div>
                <div>
                  <dt>Value</dt>
                  <dd className="num">{usd(quote.value)}</dd>
                </div>
                <div>
                  <dt>Price</dt>
                  <dd className="num">{fmtPrice(price)}</dd>
                </div>
                <div>
                  <dt>Agent suggested</dt>
                  <dd>{alert.suggestion}</dd>
                </div>
              </dl>

              {error && <p className="error-text">{error}</p>}

              </section>

              <div className="pv-foot">
                <Button variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>
                  <ArrowLeft size={14} /> Back
                </Button>
                <Button variant="primary" onClick={submit} disabled={busy}>
                  {busy ? busyLabel || "Executing…" : `Confirm ${side}`}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
