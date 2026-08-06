import { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import { AlertTriangle, ArrowLeft, Lightbulb, TrendingDown, TrendingUp } from "lucide-react";
import { Button, Field, Input, Modal } from "../../components/ui";
import { getProvider, ERC20_ABI, rpcErrorReason } from "../wallet/provider";
import { usd } from "./format";

const QUICK = [0.25, 0.5, 0.75, 1];

/**
 * Trade panel for acting on an alert. The user sets the side AND the amount —
 * the agent's suggestion is shown as a recommendation only, never enforced.
 *
 * `side`      "buy" | "sell" (chosen by the user before opening this)
 * `alert`     the alert being acted on
 * `portfolio` PAPER portfolio, for balance/position limits. Null in live mode —
 *              simulated money must never bound a real trade.
 * `chain`/`address`/`token`/`cashToken` live mode only: what to read on chain.
 * `onSubmit`  ({ action, amount, denom }) => Promise
 */
export default function TradePanel({
  side,
  alert,
  portfolio,
  mode = "paper",
  chain = null,
  address = null,
  token = null,
  cashToken = null,
  onClose,
  onSubmit,
}) {
  const isLive = mode === "live";
  const price = Number(alert.priceAtAlert) || 0;

  /**
   * REAL on-chain balance, live mode only.
   *
   * This panel used to take the paper portfolio in BOTH modes, so a live trade
   * was sized against the simulated $1,000,000 — the user picked an amount they
   * did not have, and only found out at the signing step. Buying spends the
   * stablecoin; selling spends the asset, so the relevant token differs by side.
   *
   * Goes through `getProvider`, the same proxied path as every other balance
   * read, so it inherits the endpoint fallback, timeout and concurrency cap.
   */
  const spendToken = side === "buy" ? cashToken : token;
  const [live, setLive] = useState({ loading: isLive, balance: null, error: "" });

  useEffect(() => {
    if (!isLive || !chain || !address || !spendToken) {
      setLive({ loading: false, balance: null, error: "" });
      return undefined;
    }
    let alive = true;
    setLive({ loading: true, balance: null, error: "" });
    (async () => {
      try {
        const c = new ethers.Contract(spendToken.address, ERC20_ABI, getProvider(chain.chainId));
        const raw = await c.balanceOf(address);
        if (alive) {
          setLive({
            loading: false,
            balance: Number(ethers.formatUnits(raw, spendToken.decimals)),
            error: "",
          });
        }
      } catch (err) {
        // Unknown, NOT zero. A zero here would silently cap the trade at nothing
        // and read as an empty wallet.
        if (alive) {
          setLive({
            loading: false,
            balance: null,
            error: rpcErrorReason(err) || "balance could not be read",
          });
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [isLive, chain, address, spendToken]);

  const holding = (portfolio?.holdings || []).find((h) => h.coinId === alert.coinId);
  const heldQty = holding ? holding.qty : 0;
  const cash = portfolio?.cashBalance || 0;

  /**
   * The ceiling for this side. In live mode it comes from the chain; when that
   * read failed the ceiling is 0 so no maximum is offered — better to withhold
   * the shortcut than to suggest an amount that may not exist.
   */
  const liveBal = live.balance;
  const maxQuote = isLive
    ? side === "buy"
      ? liveBal || 0
      : (liveBal || 0) * price
    : side === "buy"
      ? cash
      : heldQty * price;
  const maxToken = isLive
    ? side === "buy"
      ? price > 0
        ? (liveBal || 0) / price
        : 0
      : liveBal || 0
    : side === "buy"
      ? price > 0
        ? cash / price
        : 0
      : heldQty;

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
      cashAfter: side === "buy" ? cash - value : cash + value,
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
      ? `That is more than your available cash (${usd(cash)}).`
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
      await onSubmit({ action: side, amount, denom });
    } catch (err) {
      setError(err?.response?.data?.error || "That trade could not be completed");
      setBusy(false);
      setConfirming(false);
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
        <span className="muted small num">{usd(price)}</span>
      </div>

      {/* The amount step is identical in both modes. This only says which one is
          about to happen, so nobody spends real funds thinking it was practice. */}
      {mode === "live" ? (
        <span className="mainnet-badge">LIVE · real funds</span>
      ) : (
        <span className="pill">Paper trade · simulated funds</span>
      )}

      {/* The agent advises; the human decides. Shown in context, never enforced. */}
      <div className="agent-reasoning">
        <span className="icon-tile neutral">
          <Lightbulb size={16} />
        </span>
        <div className="grow">
          <div className="overline">Agent recommendation — {alert.suggestion}</div>
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
            <strong>{alert.suggestion}</strong>. That is your call — it will be recorded.
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
            {/* The percentage shortcuts are percentages OF THE BALANCE, so they
                are withheld when the balance is unknown rather than computed
                from a zero that only means "we could not read it". */}
            {(!isLive || live.balance != null) &&
              QUICK.map((p) => (
                <Button key={p} size="sm" onClick={() => setPct(p)}>
                  {p === 1 ? "MAX" : `${p * 100}%`}
                </Button>
              ))}
            <span className="muted small" style={{ marginLeft: "auto" }}>
              {isLive ? (
                live.loading ? (
                  <>Reading your balance on {chain ? chain.name : "chain"}…</>
                ) : live.error ? (
                  /* Never a number we did not read, and never the paper figure. */
                  <span className="value-neg">Balance unavailable: {live.error}</span>
                ) : (
                  <>
                    In your wallet:{" "}
                    <span className="num">
                      {Number(live.balance || 0).toLocaleString(undefined, {
                        maximumFractionDigits: 6,
                      })}{" "}
                      {spendToken ? spendToken.symbol : ""}
                    </span>
                  </>
                )
              ) : (
                <>
                  Available:{" "}
                  <span className="num">
                    {side === "buy" ? usd(cash) : `${heldQty.toFixed(6)} ${alert.symbol}`}
                  </span>
                </>
              )}
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
                <dd className="num">{usd(price)}</dd>
              </div>
              <div>
                <dt>Cash after</dt>
                <dd className="num">{usd(quote.cashAfter)}</dd>
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
              <dd className="num">{usd(price)}</dd>
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
              {busy ? "Executing…" : `Confirm ${side}`}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
