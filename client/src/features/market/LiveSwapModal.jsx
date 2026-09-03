import { useEffect, useState } from "react";
import { ethers } from "ethers";
import { ArrowDown, ExternalLink, ShieldCheck, TriangleAlert, X } from "lucide-react";
import { Button, Field, Input, Modal, SkeletonLines } from "../../components/ui";
import GasNotice from "../wallet/GasNotice";
import { approveRouter, executeSwap, planSwap } from "./liveSwap";

/**
 * The live half of a trade. The Buy/Sell decision and the amount are already
 * made in TradePanel exactly as they are in paper mode — this screen only
 * handles what happens on confirm: quote, checks, approval, signature.
 *
 * Matches the SendForm and SweepModal shape deliberately: full summary, then the
 * password, then signing. Approval and swap are two separate authorisations.
 */
/**
 * A display amount to raw units, WITHOUT throwing on precision.
 *
 * `parseUnits(String(x), decimals)` throws "too many decimals for format" the
 * moment `x` carries more decimal places than the token has. A sell of "$100 of
 * WBTC" converts to 100 / 63214.37 = 0.0015819187947297426, nineteen places
 * against WBTC's eight, and the modal died on mount with the raw ethers error.
 * Every wrapped bitcoin and every 6 decimal stablecoin hit it, so selling
 * Bitcoin failed on six of seven chains. The value is rounded DOWN to the
 * token's own precision first: a trade can only ever spend a whole unit.
 */
function toUnits(amountDisplay, decimals) {
  const n = Number(amountDisplay);
  if (!Number.isFinite(n) || n <= 0) throw new Error("Enter an amount greater than zero.");
  const factor = 10 ** decimals;
  const floored = Math.floor(n * factor) / factor;
  return ethers.parseUnits(floored.toFixed(decimals), decimals);
}

export default function LiveSwapModal({
  chain,
  address,
  side,
  coin,
  token,
  cash,
  amountDisplay,
  alertId,
  spentToday,
  limitOverrides,
  onClose,
  onDone,
}) {
  // Buy spends stablecoin for the asset; sell returns the asset to stablecoin.
  const tokenIn = side === "buy" ? cash : token;
  const tokenOut = side === "buy" ? token : cash;

  const [plan, setPlan] = useState(null);
  const [planError, setPlanError] = useState("");
  const [slippage, setSlippage] = useState(1);
  const [password, setPassword] = useState("");
  const [step, setStep] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [impactAccepted, setImpactAccepted] = useState(false);
  const [done, setDone] = useState(null);

  useEffect(() => {
    let live = true;
    setPlan(null);
    setPlanError("");
    // The daily cap cannot be checked without knowing what was already spent.
    // Wait for the figure rather than planning against an assumed zero.
    if (spentToday == null) return undefined;
    (async () => {
      try {
        const amountIn = toUnits(amountDisplay, tokenIn.decimals);
        const p = await planSwap({
          chain,
          address,
          tokenIn,
          tokenOut,
          amountIn,
          amountInDisplay: Number(amountDisplay),
          slippagePct: slippage,
          limitOverrides,
          spentToday,
        });
        if (live) setPlan(p);
      } catch (err) {
        if (live) setPlanError(err?.shortMessage || err?.message || "Could not price this trade.");
      }
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slippage, spentToday]);

  const explorerTx = (h) => (chain.explorer ? `${chain.explorer}/tx/${h}` : null);

  async function doApprove() {
    setBusy(true);
    setError("");
    try {
      await approveRouter({ plan, password, onStep: setStep });
      setPassword("");
      /**
       * Re-plan so the allowance and gas are re-read, and keep the OLD plan on
       * screen until the new one exists. This used to clear `plan` first and
       * then re-plan; if the re-quote failed after the approval had been mined
       * and paid for, the error was written to a state that only rendered
       * inside the plan branch, and the plan was null, so the person got four
       * grey bars forever with an approval on chain and no explanation.
       */
      const amountIn = toUnits(amountDisplay, tokenIn.decimals);
      const next = await planSwap({
        chain, address, tokenIn, tokenOut, amountIn,
        amountInDisplay: Number(amountDisplay), slippagePct: slippage,
        limitOverrides, spentToday,
      });
      setPlan(next);
    } catch (err) {
      setError(
        `${friendly(err)} Your approval may already be confirmed on chain; close and reopen this trade to continue without paying for it again.`
      );
    } finally {
      setBusy(false);
      setStep("");
    }
  }

  async function doSwap() {
    setBusy(true);
    setError("");
    try {
      const res = await executeSwap({ plan, password, side, alertId, onStep: setStep });
      setPassword("");
      setDone(res);
      onDone && onDone(res);
    } catch (err) {
      setError(friendly(err));
    } finally {
      setBusy(false);
      setStep("");
    }
  }

  function friendly(err) {
    const m = err?.shortMessage || err?.reason || err?.message || "That transaction failed.";
    if (/incorrect password|could not decrypt|invalid password/i.test(m)) return "Incorrect password.";
    return m;
  }

  const blocked = plan && !plan.ok;
  const impactBlocking = plan?.needsExtraConfirm && !impactAccepted;

  return (
    <Modal label="Confirm live trade" onClose={busy ? () => {} : onClose} size="lg">
      <div className="row space-between">
        <h3 className="section-title">
          {side === "buy" ? "Buy" : "Sell"} {coin.symbol} · live
        </h3>
        <Button variant="ghost" icon title="Close" onClick={onClose} disabled={busy}>
          <X size={15} />
        </Button>
      </div>

      {/* Rendered ABOVE the branches, so a failure is visible in every state,
          including the one where there is no plan to show it under. */}
      {error && !done && (
        <div className="against-note" role="alert">
          <TriangleAlert size={15} />
          <span>{error}</span>
        </div>
      )}

      {done ? (
        <>
          <div className="crypto-notice">
            <span className="icon-tile pos">
              <ShieldCheck size={16} />
            </span>
            <div className="grow">
              <div className="card-title">Trade submitted</div>
              <p className="muted small" style={{ margin: "4px 0 0" }}>
                {amountDisplay} {tokenIn.symbol} for about {Number(done.amountOut).toFixed(6)}{" "}
                {tokenOut.symbol}. It appears in your wallet history and confirms in a few seconds.
              </p>
            </div>
          </div>
          {explorerTx(done.txHash) && (
            <a className="tx-hash-link" href={explorerTx(done.txHash)} target="_blank" rel="noopener noreferrer">
              View on the explorer <ExternalLink size={12} />
            </a>
          )}
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <Button variant="primary" onClick={onClose}>Done</Button>
          </div>
        </>
      ) : planError ? (
        <div className="against-note">
          <TriangleAlert size={15} />
          <span>{planError}</span>
        </div>
      ) : !plan ? (
        <SkeletonLines count={4} />
      ) : (
        <>
          <dl className="trade-quote">
            <div>
              <dt>You pay</dt>
              <dd className="num">{amountDisplay} {tokenIn.symbol}</dd>
            </div>
            <div>
              <dt>You receive, about</dt>
              <dd className="num">
                {Number(ethers.formatUnits(plan.quote.amountOut, tokenOut.decimals)).toFixed(6)}{" "}
                {tokenOut.symbol}
                <span className="quote-sub">
                  best of {plan.quote.alternatives} fee tier
                  {plan.quote.alternatives === 1 ? "" : "s"} · routed at {plan.quote.fee / 10000}%
                </span>
              </dd>
            </div>
            <div>
              <dt>Price impact</dt>
              <dd className={`num ${plan.quote.impactPct > plan.limits.maxPriceImpactPct ? "value-neg" : "value-pos"}`}>
                {plan.quote.impactPct.toFixed(2)}%
                <span className="quote-sub">
                  what the pool's depth costs you at this size
                </span>
              </dd>
            </div>
            <div>
              <dt>Minimum received</dt>
              <dd className="num">
                {Number(ethers.formatUnits(plan.amountOutMinimum, tokenOut.decimals)).toFixed(6)}{" "}
                {tokenOut.symbol}
                <span className="quote-sub">after {slippage}% slippage, or it reverts</span>
              </dd>
            </div>
            {plan.gas && (
              <div>
                <dt>Network fee</dt>
                <dd className="num">
                  ≈ {Number(ethers.formatEther(plan.gas.feeWei)).toFixed(6)} {chain.nativeSymbol}
                </dd>
              </div>
            )}
          </dl>

          <Field label="Slippage tolerance">
            <div className="row">
              {[0.5, 1, 3].map((s) => (
                <Button key={s} variant={slippage === s ? "secondary" : "ghost"} onClick={() => setSlippage(s)} disabled={busy}>
                  {s}%
                </Button>
              ))}
            </div>
          </Field>

          <GasNotice plan={plan.gas} chain={chain} />

          {plan.blocks.map((b, i) => (
            <div className="against-note" key={i}>
              <TriangleAlert size={15} />
              <span>{b}</span>
            </div>
          ))}

          {plan.warnings.map((w, i) => (
            <div className="against-note" key={`w${i}`}>
              <TriangleAlert size={15} />
              <span>{w}</span>
            </div>
          ))}

          {plan.needsExtraConfirm && (
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={impactAccepted}
                onChange={(e) => setImpactAccepted(e.target.checked)}
              />
              <span>
                <span className="toggle-title">I accept losing about {plan.quote.impactPct.toFixed(2)}% to price impact</span>
                <span className="muted small">This pool is thin at this size. A smaller amount would cost less.</span>
              </span>
            </label>
          )}

          {plan.needsApproval ? (
            <>
              <p className="settings-note">
                <ShieldCheck size={15} />
                Before the swap you must allow the exchange to move your {tokenIn.symbol}. That is a
                separate transaction, for exactly this amount rather than an open-ended allowance.
              </p>
              <Field label="Wallet password">
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy} />
              </Field>
              <div className="row" style={{ justifyContent: "flex-end" }}>
                <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
                <Button variant="primary" onClick={doApprove} disabled={busy || !password || blocked}>
                  {busy ? step || "Approving…" : `Approve ${tokenIn.symbol}`}
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="settings-note">
                <ShieldCheck size={15} />
                Your password decrypts the key in this browser to sign this one transaction, then it
                is discarded. Nothing is signed on our servers and the agent never signs.
              </p>
              <Field label="Wallet password">
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy} />
              </Field>
              <div className="row" style={{ justifyContent: "flex-end" }}>
                <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
                <Button
                  variant="primary"
                  onClick={doSwap}
                  disabled={busy || !password || blocked || impactBlocking}
                >
                  {busy ? step || "Signing…" : `Sign and ${side === "buy" ? "buy" : "sell"}`}
                </Button>
              </div>
            </>
          )}
        </>
      )}
    </Modal>
  );
}
