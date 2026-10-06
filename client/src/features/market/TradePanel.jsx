import { useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, Lightbulb, TrendingDown, TrendingUp } from "lucide-react";
import { Button, Field, Input, Modal } from "../../components/ui";
// `usd` for money amounts, `fmtPrice` for a COIN PRICE. `usd` caps at two
// decimals, so every price line on this panel read "$0" for a coin worth a
// hundred thousandth of a dollar, which is most of the long tail the universal
// resolver opened live trading to.
import { usd, price as fmtPrice } from "./format";

const QUICK = [0.25, 0.5, 0.75, 1];

/**
 * Trade panel for acting on an alert. The user sets the side AND the amount —
 * the agent's suggestion is shown as a recommendation only, never enforced.
 *
 * `side`      "buy" | "sell" (chosen by the user before opening this)
 * `alert`     the alert being acted on
 * `portfolio` live portfolio, for balance/position limits
 * `onSubmit`  ({ action, amount, denom }) => Promise
 */
export default function TradePanel({
  side,
  alert,
  portfolio,
  onClose,
  onSubmit,
  busyLabel,
  /**
   * The coin's price NOW, from the live market feed. Optional: when it is absent
   * or stale the alert's captured price is used, as before.
   */
  currentPrice,
}) {
  /**
   * THE PRICE THE USER IS ACTUALLY TRADING AT, NOT THE ONE THAT RAISED THE ALERT.
   *
   * `priceAtAlert` is a snapshot from the moment the condition fired. Everything
   * on this panel was computed from it: the ceiling on what can be spent, the
   * token/quote conversion, and the figures on the confirm screen. An alert
   * sitting unanswered for an hour — which is normal, since the whole design is
   * that a human decides — therefore priced the trade at an hour-old number.
   *
   * On a coin that moved 20% in that hour, "spend $100" converted to a token
   * quantity that was 20% wrong, and the confirm screen showed a value the user
   * would not get. In live mode the swap then quotes at the real price anyway,
   * so the number on screen and the number executed were simply different.
   *
   * The live price wins where there is one. The alert's price remains the
   * fallback, and the difference is shown below rather than quietly applied.
   */
  const alertPrice = Number(alert.priceAtAlert) || 0;
  const livePrice = Number(currentPrice) || 0;
  const price = livePrice > 0 ? livePrice : alertPrice;
  const moved =
    livePrice > 0 && alertPrice > 0
      ? ((livePrice - alertPrice) / alertPrice) * 100
      : 0;
  const holding = (portfolio?.holdings || []).find((h) => h.coinId === alert.coinId);
  const heldQty = holding ? holding.qty : 0;

  /**
   * "COULD NOT BE READ" IS NOT "$0" (hard rule 4).
   *
   * This was `portfolio?.cashBalance || 0`, so a live book whose stablecoin
   * balance came back unreadable arrived here as a hard zero. The panel then
   * told the owner "Available: $0" and refused every buy with "That is more
   * than your available cash ($0)" — a statement about their money that the app
   * had no way to know, produced by one RPC call that did not answer. The live
   * book now sends null for a balance it does not know, and this panel still
   * blocks the trade, which is the safe direction, but says the true reason.
   */
  const cashKnown = Number.isFinite(Number(portfolio?.cashBalance));
  const cash = cashKnown ? Number(portfolio.cashBalance) : null;
  const cashLabel = cashKnown ? usd(cash) : "could not be read";

  // The ceiling for this side: cash to spend on a buy, tokens held on a sell.
  // An unknown cash balance is a ceiling of zero — nothing can be authorised
  // against a figure nobody has — and the message below says so rather than
  // naming an amount.
  const maxQuote = side === "buy" ? cash || 0 : heldQty * price;
  const maxToken = side === "buy" ? (price > 0 ? (cash || 0) / price : 0) : heldQty;

  const [denom, setDenom] = useState(side === "buy" ? "quote" : "token");
  const [raw, setRaw] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const amount = Number(raw) || 0;
  const max = denom === "quote" ? maxQuote : maxToken;

  // One source of truth for both denominations, so the quote and the request agree.
  const quote = useMemo(() => {
    const qty = denom === "quote" ? (price > 0 ? amount / price : 0) : amount;
    const value = denom === "quote" ? amount : amount * price;
    return {
      qty,
      value,
      // Null rather than NaN when the balance is unknown: an arithmetic result
      // built on a figure we do not have is an invented one.
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

  /**
   * THE PANEL USED TO JAM ON EVERY REFUSAL.
   *
   * `busy` was cleared only in the catch. In live mode `onSubmit` answers "no"
   * by RESOLVING — the coin is paper only here, the contract lookup could not be
   * completed, the amount could not be converted, this browser holds no wallet —
   * and every one of those resolutions left `busy` true forever. Confirm stayed
   * greyed out reading "Checking the contract…", Back was greyed out beside it,
   * and the only way out was the close cross, which threw away the amount typed.
   * Since the refusal paths added for the universal resolver this is the common
   * outcome rather than a rare one.
   *
   * `busy` now clears whichever way the call ends, and a refusal that comes back
   * as `{ ok: false, message }` is shown here — on the screen the person is
   * looking at, with their amount still in the field — instead of only as a
   * toast that had already gone by the time they read it.
   */
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

  const Icon = side === "buy" ? TrendingUp : TrendingDown;
  const wentAgainst = alert.suggestion !== "hold" && alert.suggestion !== side;

  return (
    <Modal label={`${side === "buy" ? "Buy" : "Sell"} ${alert.symbol}`} onClose={onClose}>
      <div className="row space-between">
        <h3 className="section-title">
          <Icon size={18} style={{ verticalAlign: "-3px", marginRight: 6 }} />
          {side === "buy" ? "Buy" : "Sell"} {alert.symbol}
        </h3>
        <span className="muted small num">{fmtPrice(price)}</span>
      </div>

      {/* The alert fired at one price and is being acted on at another. Shown
          rather than silently applied, because the gap is the reason the figures
          differ from the ones in the alert the user just read. */}
      {Math.abs(moved) >= 0.5 && (
        <div className="against-note">
          {alert.symbol} has moved {moved > 0 ? "up" : "down"} {Math.abs(moved).toFixed(1)}% since
          this alert was raised, from {fmtPrice(alertPrice)} to {fmtPrice(livePrice)}. The amounts below use
          the price now.
        </div>
      )}

      {/* The agent advises; the human decides. Shown in context, never enforced. */}
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

          <div className="row" style={{ justifyContent: "flex-end" }}>
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
          <div className="settings-head">
            <h4 className="card-title">Confirm this {side}</h4>
            <p className="muted small">Nothing executes until you confirm.</p>
          </div>

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

          <div className="row" style={{ justifyContent: "flex-end" }}>
            <Button variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>
              <ArrowLeft size={14} /> Back
            </Button>
            <Button variant="primary" onClick={submit} disabled={busy}>
              {/* A live trade spends this moment checking the coin's contract on
                  the chain, which is not executing anything. Saying "Executing"
                  there would name the wrong thing at the one moment the user is
                  watching most closely. */}
              {busy ? busyLabel || "Executing…" : `Confirm ${side}`}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
