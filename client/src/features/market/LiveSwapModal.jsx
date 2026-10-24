import { useEffect, useState } from "react";
import { ethers } from "ethers";
import { ExternalLink, ShieldCheck, TriangleAlert, X } from "lucide-react";
import { Button, Field, Input, Modal, SkeletonLines, useToast, PageHeader } from "../../components/ui";
import http from "../../api/http";
import { useAuth } from "../../context/AuthContext";
import GasNotice from "../wallet/GasNotice";
import { approveRouter, executeSwap, planSwap } from "./liveSwap";
import TokenProvenanceNotice, {
  acknowledgeToken,
  isTokenAcknowledged,
  needsAcknowledgement,
} from "./TokenProvenanceNotice";

function toUnits(amountDisplay, decimals) {
  const n = Number(amountDisplay);
  if (!Number.isFinite(n) || n <= 0) throw new Error("Enter an amount greater than zero.");
  const places = Math.max(0, Math.min(Number(decimals) || 0, 100));
  let s = String(n);
  if (/e/i.test(s)) s = n.toFixed(Math.min(places + 2, 100));
  const [whole, frac = ""] = s.split(".");
  const truncated = frac.slice(0, places);
  return ethers.parseUnits(truncated ? `${whole}.${truncated}` : whole, decimals);
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
  spentTodayError = "",
  onRetrySpentToday,
  resolveWarnings = [],
  limitOverrides,
  onClose,
  onDone,
}) {
  const toast = useToast();
  const { user, refreshUser } = useAuth();

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
  const [safetyAccepted, setSafetyAccepted] = useState(false);
  const [done, setDone] = useState(null);
  const [replan, setReplan] = useState(0);

  const [addressChecked, setAddressChecked] = useState(() =>
    isTokenAcknowledged(chain?.chainId, token?.address)
  );

  useEffect(() => {
    let live = true;
    setPlan(null);
    setPlanError("");
    setImpactAccepted(false);
    setSafetyAccepted(false);
    if (spentToday == null) return undefined;
    (async () => {
      try {
        const amountIn = toUnits(amountDisplay, tokenIn.decimals);
        const p = await planSwap({
          chain,
          address,
          side,
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
  }, [slippage, spentToday, replan]);

  const explorerTx = (h) => (chain.explorer ? `${chain.explorer}/tx/${h}` : null);

  async function doApprove({ reset = false } = {}) {
    setBusy(true);
    setError("");
    try {
      const approval = await approveRouter({ plan, password, reset, onStep: setStep });
      setPassword("");
      if (!approval.recorded) {
        toast(
          (reset
            ? "The allowance reset went through, but it could not be saved to your history. Transaction "
            : "The approval went through, but it could not be saved to your history. Transaction ") +
            String(approval.hash).slice(0, 10) + "…",
          { type: "error", duration: 12000 }
        );
      }
      const amountIn = toUnits(amountDisplay, tokenIn.decimals);
      const next = await planSwap({
        chain, address, side, tokenIn, tokenOut, amountIn,
        amountInDisplay: Number(amountDisplay), slippagePct: slippage,
        limitOverrides, spentToday,
      });
      setPlan(next);
      setImpactAccepted(false);
      setSafetyAccepted(false);
    } catch (err) {
      setError(
        reset
          ? `${friendly(err)} The reset may already be confirmed on chain; close and reopen this trade to check before paying for it again.`
          : `${friendly(err)} Your approval may already be confirmed on chain; close and reopen this trade to continue without paying for it again.`
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

      if (side === "buy" && plan.tokenOut && !plan.tokenOut.custom) {
        const known = (user?.customTokens || []).some(
          (t) =>
            t.chainId === plan.chain.chainId &&
            String(t.address).toLowerCase() === String(plan.tokenOut.address).toLowerCase()
        );
        const inRegistry = (plan.chain.tokens || []).some(
          (t) => String(t.address).toLowerCase() === String(plan.tokenOut.address).toLowerCase()
        );
        if (!known && !inRegistry) {
          try {
            await http.post("/api/trading/tokens", {
              chainId: plan.chain.chainId,
              address: plan.tokenOut.address,
              symbol: plan.tokenOut.symbol,
              decimals: plan.tokenOut.decimals,
            });
            await refreshUser?.();
          } catch (addErr) {
            toast(
              `${plan.tokenOut.symbol} was bought but could not be added to your token list, so it ` +
                "will not show in your portfolio. Add it by address in the wallet.",
              { type: "error", duration: 12000 }
            );
            console.error("could not remember the bought token", addErr);
          }
        }
      }

      if (alertId) {
        try {
          await http.post(`/api/alerts/${alertId}/executed`, {
            side,
            txHash: res.txHash,
            chainId: plan.chain.chainId,
            qty: Number(res.amountOut) || null,
            value: Number(plan.cashValueDisplay ?? plan.amountInDisplay) || null,
            price: Number(plan.quote?.price) || null,
          });
        } catch (closeErr) {
          toast(
            "The trade went through, but this alert could not be marked as handled. " +
              "Dismiss it manually, or this coin will not alert you again.",
            { type: "error", duration: 12000 }
          );
          console.error("alert close failed", closeErr);
        }
      }

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
  const addressBlocking = needsAcknowledgement(token) && !addressChecked;
  const safetyBlocking = plan?.needsSafetyAck && !safetyAccepted;
  const soldBack =
    plan?.safety?.checked && plan.safety.ok && plan.safety.soldBack != null ? plan.safety : null;

  return (
    <Modal
      label="Confirm live trade"
      view="swap"
      crumb={`${side === "buy" ? "Buy" : "Sell"} ${coin.symbol} · live`}
      onClose={busy ? () => {} : onClose}
      size="lg"
    >
      <PageHeader
        title={
          <>
            {side === "buy" ? "Buy" : "Sell"} {coin.symbol} · live
          </>
        }
        action={
          <Button variant="ghost" icon title="Close" onClick={onClose} disabled={busy}>
            <X size={15} />
          </Button>
        }
      />

      <section className="card stack">

      {error && !done && (
        <div className="against-note" role="alert">
          <TriangleAlert size={15} />
          <span>{error}</span>
        </div>
      )}

      {done ? (
        <>
          {done.broadcast === "unknown" ? (
            <div className="against-note" role="alert">
              <TriangleAlert size={15} />
              <span>
                This swap was signed and sent, but the network did not confirm that it received it
                ({done.broadcastReason}). It is saved in your history as pending and counts towards
                today&apos;s limit until the chain reports it. Check it on the explorer before you
                trade again, so it is not bought twice.
              </span>
            </div>
          ) : (
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
          )}
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
      ) : spentToday == null && spentTodayError ? (
        <>
          <div className="against-note" role="alert">
            <TriangleAlert size={15} />
            <span>
              How much you have already spent on live trades in the last 24 hours could not be read
              ({spentTodayError}), and the daily cap cannot be checked without it, so this trade was
              not priced. Nothing was assumed and nothing was signed.
            </span>
          </div>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <Button variant="ghost" onClick={onClose}>Close</Button>
            {onRetrySpentToday && (
              <Button variant="primary" onClick={onRetrySpentToday}>Try again</Button>
            )}
          </div>
        </>
      ) : !plan ? (
        <SkeletonLines count={4} />
      ) : !plan.quote ? (
        <>
          {plan.blocks.map((b, i) => (
            <div className="against-note" key={i}>
              <TriangleAlert size={15} />
              <span>{b}</span>
            </div>
          ))}
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <Button variant="ghost" onClick={onClose}>Close</Button>
            <Button variant="primary" onClick={() => setReplan((n) => n + 1)} disabled={busy}>
              Try again
            </Button>
          </div>
        </>
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
                  best of {plan.quote.alternatives} route
                  {plan.quote.alternatives === 1 ? "" : "s"} ·{" "}
                  {plan.quote.via
                    ? `through ${plan.quote.via} at ${plan.quote.fees
                        .map((f) => f / 10000 + "%")
                        .join(" then ")}`
                    : `direct at ${plan.quote.fee / 10000}%`}
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
            {soldBack && (
              <div>
                <dt>Selling it straight back</dt>
                <dd className="num">
                  ≈ {Number(ethers.formatUnits(soldBack.soldBack, tokenIn.decimals)).toFixed(6)}{" "}
                  {tokenIn.symbol}
                  <span className="quote-sub">
                    for the minimum received, in a simulation run before signing
                  </span>
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

          {(resolveWarnings || []).map((w, i) => (
            <div className="against-note" key={`rw${i}`}>
              <TriangleAlert size={15} />
              <span>{w}</span>
            </div>
          ))}

          <TokenProvenanceNotice
            token={token}
            chain={chain}
            checked={addressChecked}
            disabled={busy}
            onChange={(v) => {
              setAddressChecked(v);
              if (v) acknowledgeToken(chain?.chainId, token?.address);
            }}
          />

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

          {plan.needsSafetyAck && (
            <>
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={safetyAccepted}
                  disabled={busy}
                  onChange={(e) => setSafetyAccepted(e.target.checked)}
                />
                <span>
                  <span className="toggle-title">
                    I accept that {tokenOut.symbol} could not be checked for being sold again
                  </span>
                  <span className="muted small">
                    Asked for this trade only. Tokens on the hand-checked list for this network do not
                    need it.
                  </span>
                </span>
              </label>
              <div className="row" style={{ justifyContent: "flex-end" }}>
                <Button variant="ghost" onClick={() => setReplan((n) => n + 1)} disabled={busy}>
                  Check again
                </Button>
              </div>
            </>
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
                {plan.needsAllowanceReset ? (
                  <Button
                    variant="primary"
                    onClick={() => doApprove({ reset: true })}
                    disabled={busy || !password || addressBlocking}
                  >
                    {busy ? step || "Resetting…" : `Reset the ${tokenIn.symbol} allowance to zero`}
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    onClick={() => doApprove()}
                    disabled={busy || !password || blocked || addressBlocking || safetyBlocking}
                  >
                    {busy ? step || "Approving…" : `Approve ${tokenIn.symbol}`}
                  </Button>
                )}
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
                  disabled={busy || !password || blocked || impactBlocking || addressBlocking || safetyBlocking}
                >
                  {busy ? step || "Signing…" : `Sign and ${side === "buy" ? "buy" : "sell"}`}
                </Button>
              </div>
            </>
          )}
        </>
      )}
      </section>
    </Modal>
  );
}
