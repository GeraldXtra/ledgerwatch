import { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import { ArrowDownUp, ExternalLink, ShieldCheck, TriangleAlert } from "lucide-react";
import { Button, Field, Input, Select, SkeletonLines } from "../../../components/ui";
import GasNotice from "../GasNotice";
import { fetchSpend24h } from "../walletApi";
import { approveRouter, executeSwap } from "../../market/liveSwap";
import TokenProvenanceNotice, {
  acknowledgeToken,
  isTokenAcknowledged,
  needsAcknowledgement,
} from "../../market/TokenProvenanceNotice";
import { isCashToken } from "../../market/tradeability";
import { assetBalance, findAsset, swapAssets } from "./assets";
import { planEvmSwap, swapKind, toUnits } from "./evmSwap";

const SLIPPAGES = [0.5, 1, 3];

function defaultFrom(assets, balances) {
  const cash = assets.find((a) => isCashToken(a) && (assetBalance(a, balances) || 0) > 0);
  return (cash || assets[0] || {}).key || "";
}

function defaultTo(assets, fromKey) {
  const other = assets.find((a) => a.key !== fromKey && (a.native || isCashToken(a))) || assets.find((a) => a.key !== fromKey);
  return (other || {}).key || "";
}

function fmtBalance(n) {
  if (n == null) return "";
  return Number(n).toLocaleString("en-US", { maximumFractionDigits: 6 });
}

function friendly(err) {
  const m = err?.shortMessage || err?.reason || err?.message || "That did not go through.";
  if (/incorrect password|could not decrypt|invalid password/i.test(m)) return "Incorrect password.";
  return m;
}

export default function SwapPanel({ chain, address, tokens, balances, usdPrices, limitOverrides, onSwapped }) {
  const assets = useMemo(() => swapAssets(chain, tokens), [chain, tokens]);
  const [fromKey, setFromKey] = useState(() => defaultFrom(assets, balances));
  const [toKey, setToKey] = useState(() => defaultTo(assets, defaultFrom(assets, balances)));
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState(1);
  const [spentToday, setSpentToday] = useState(null);
  const [spendError, setSpendError] = useState("");
  const [plan, setPlan] = useState(null);
  const [planning, setPlanning] = useState(false);
  const [planError, setPlanError] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(null);
  const [impactAccepted, setImpactAccepted] = useState(false);
  const [safetyAccepted, setSafetyAccepted] = useState(false);
  const [addressChecked, setAddressChecked] = useState(false);

  const from = findAsset(assets, fromKey);
  const to = findAsset(assets, toKey);
  const kind = swapKind(chain, from, to);
  const fromBalance = assetBalance(from, balances);
  const usdPriceFor = (symbol) => {
    const p = usdPrices ? usdPrices[String(symbol || "").toUpperCase()] : undefined;
    return Number.isFinite(p) ? p : null;
  };

  function loadSpend() {
    setSpendError("");
    fetchSpend24h()
      .then((n) => setSpentToday(n))
      .catch((err) => {
        setSpentToday(null);
        setSpendError(err?.response?.data?.error || err?.message || "the server did not answer");
      });
  }

  useEffect(() => {
    loadSpend();
  }, []);

  useEffect(() => {
    setAddressChecked(to && !to.native ? isTokenAcknowledged(chain?.chainId, to.address) : false);
  }, [chain?.chainId, to]);

  function resetPlan() {
    setPlan(null);
    setPlanError("");
    setImpactAccepted(false);
    setSafetyAccepted(false);
    setError("");
  }

  async function getQuote(slippagePct = slippage) {
    resetPlan();
    if (!from || !to) return setPlanError("Pick what to pay and what to receive.");
    if (kind === "same") return setPlanError("Pick two different assets.");
    if (spentToday == null) {
      return setPlanError(
        `How much you have already swapped in the last 24 hours could not be read (${spendError || "no answer"}), ` +
          "and the daily cap cannot be checked without it, so nothing was priced."
      );
    }
    setPlanning(true);
    try {
      const amountIn = toUnits(amount, from.decimals);
      const p = await planEvmSwap({
        chain,
        address,
        from,
        to,
        amountIn,
        amountInDisplay: Number(amount),
        slippagePct,
        limitOverrides,
        spentToday,
        usdPriceFor,
      });
      setPlan(p);
    } catch (err) {
      setPlanError(err?.shortMessage || err?.message || "This swap could not be priced.");
    } finally {
      setPlanning(false);
    }
  }

  function flip() {
    const a = fromKey;
    setFromKey(toKey);
    setToKey(a);
    resetPlan();
  }

  function pickSlippage(s) {
    setSlippage(s);
    if (plan && plan.quote) getQuote(s);
  }

  async function doApprove({ reset = false } = {}) {
    setBusy(true);
    setError("");
    try {
      await approveRouter({ plan, password, reset, onStep: setStep });
      setPassword("");
      await getQuote();
    } catch (err) {
      setError(
        `${friendly(err)} ${
          reset
            ? "The reset may already be confirmed on chain; get a fresh quote before paying for it again."
            : "The approval may already be confirmed on chain; get a fresh quote to continue without paying for it again."
        }`
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
      const res = await executeSwap({ plan, password, side: null, onStep: setStep });
      setPassword("");
      setDone({ ...res, plan });
      setPlan(null);
      if (onSwapped) onSwapped(res);
    } catch (err) {
      setError(friendly(err));
    } finally {
      setBusy(false);
      setStep("");
    }
  }

  const explorerTx = (h) => (chain && chain.explorer ? `${chain.explorer}/tx/${h}` : null);

  if (!assets.length) {
    return <p className="muted small">No asset on {chain.name} can be swapped here.</p>;
  }

  if (done) {
    const p = done.plan;
    return (
      <div className="stack">
        {done.broadcast === "unknown" ? (
          <div className="against-note" role="alert">
            <TriangleAlert size={15} />
            <span>
              This swap was signed and sent, but the network did not confirm that it received it
              ({done.broadcastReason}). It is saved in your history as pending and counts towards
              today&apos;s limit until the chain reports it. Check it on the explorer before you swap
              again, so it is not done twice.
            </span>
          </div>
        ) : (
          <div className="crypto-notice">
            <span className="icon-tile pos">
              <ShieldCheck size={16} />
            </span>
            <div className="grow">
              <div className="card-title">Swap submitted</div>
              <p className="muted small" style={{ margin: "4px 0 0" }}>
                {p.amountInDisplay} {p.from.symbol} for about {Number(done.amountOut).toFixed(6)} {p.to.symbol}. It
                appears in your activity and confirms in a few seconds.
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
          <Button
            variant="primary"
            onClick={() => {
              setDone(null);
              setAmount("");
            }}
          >
            Swap again
          </Button>
        </div>
      </div>
    );
  }

  const blocked = plan && !plan.ok;
  const impactBlocking = plan?.needsExtraConfirm && !impactAccepted;
  const safetyBlocking = plan?.needsSafetyAck && !safetyAccepted;
  const addressBlocking = to && needsAcknowledgement(to) && !addressChecked;
  const soldBack = plan?.safety?.checked && plan.safety.ok && plan.safety.soldBack != null ? plan.safety : null;
  const formDisabled = busy || planning;

  return (
    <div className="stack">
      <p className="muted small" style={{ margin: 0 }}>
        Swap one asset for another on {chain.name}, through its verified exchange, from this wallet.
        Swaps happen on one network at a time; the same coin on another network is a different asset.
      </p>

      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          getQuote();
        }}
      >
        <div className="swap-pair">
          <Field label="You pay">
            <Select
              value={fromKey}
              onChange={(e) => {
                setFromKey(e.target.value);
                if (e.target.value === toKey) setToKey(defaultTo(assets, e.target.value));
                resetPlan();
              }}
              disabled={formDisabled}
            >
              {assets.map((a) => (
                <option key={a.key} value={a.key}>
                  {a.symbol}
                  {assetBalance(a, balances) != null ? ` (${fmtBalance(assetBalance(a, balances))})` : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Button variant="ghost" icon type="button" title="Swap the two sides" onClick={flip} disabled={formDisabled}>
            <ArrowDownUp size={15} />
          </Button>
          <Field label="You receive">
            <Select
              value={toKey}
              onChange={(e) => {
                setToKey(e.target.value);
                resetPlan();
              }}
              disabled={formDisabled}
            >
              {assets
                .filter((a) => a.key !== fromKey)
                .map((a) => (
                  <option key={a.key} value={a.key}>
                    {a.symbol}
                    {a.custom ? " (added by you)" : ""}
                  </option>
                ))}
            </Select>
          </Field>
        </div>

        <Field label={`Amount of ${from ? from.symbol : "the asset"} to pay`}>
          <div className="row">
            <Input
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                resetPlan();
              }}
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.00"
              disabled={formDisabled}
            />
            {from && !from.native && fromBalance != null && fromBalance > 0 && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setAmount(String(fromBalance));
                  resetPlan();
                }}
                disabled={formDisabled}
              >
                Max
              </Button>
            )}
          </div>
        </Field>
        {from && (
          <p className="muted caption" style={{ margin: "-6px 0 0" }}>
            {fromBalance == null
              ? `Your ${from.symbol} balance could not be read just now.`
              : `You hold ${fmtBalance(fromBalance)} ${from.symbol} on ${chain.name}.`}
            {from.native ? " Keep some back for network fees." : ""}
          </p>
        )}

        <Field label="Slippage tolerance">
          <div className="row">
            {SLIPPAGES.map((s) => (
              <Button key={s} type="button" variant={slippage === s ? "secondary" : "ghost"} onClick={() => pickSlippage(s)} disabled={formDisabled}>
                {s}%
              </Button>
            ))}
          </div>
        </Field>

        {spendError && spentToday == null && (
          <div className="against-note" role="alert">
            <TriangleAlert size={15} />
            <span>
              How much you have already swapped in the last 24 hours could not be read ({spendError}), and the daily
              cap cannot be checked without it.{" "}
              <button type="button" className="mm-linkish" onClick={loadSpend}>
                Try again
              </button>
            </span>
          </div>
        )}

        {!plan && (
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <Button variant="primary" type="submit" disabled={formDisabled || !amount || !from || !to}>
              {planning ? "Pricing…" : "Get a quote"}
            </Button>
          </div>
        )}
      </form>

      {planning && <SkeletonLines count={3} />}

      {planError && (
        <div className="against-note" role="alert">
          <TriangleAlert size={15} />
          <span>{planError}</span>
        </div>
      )}

      {error && (
        <div className="against-note" role="alert">
          <TriangleAlert size={15} />
          <span>{error}</span>
        </div>
      )}

      {plan && !plan.quote && (
        <>
          {plan.blocks.map((b, i) => (
            <div className="against-note" key={i}>
              <TriangleAlert size={15} />
              <span>{b}</span>
            </div>
          ))}
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <Button variant="primary" onClick={() => getQuote()} disabled={busy}>
              Try again
            </Button>
          </div>
        </>
      )}

      {plan && plan.quote && (
        <>
          <dl className="trade-quote">
            <div>
              <dt>You pay</dt>
              <dd className="num">
                {plan.amountInDisplay} {plan.from.symbol}
              </dd>
            </div>
            <div>
              <dt>You receive, about</dt>
              <dd className="num">
                {Number(plan.amountOutDisplay).toFixed(6)} {plan.to.symbol}
                <span className="quote-sub">
                  {plan.kind === "wrap" || plan.kind === "unwrap"
                    ? "one for one, no exchange involved"
                    : plan.quote.via
                      ? `through ${plan.quote.via} at ${plan.quote.fees.map((f) => f / 10000 + "%").join(" then ")}`
                      : `direct at ${plan.quote.fee / 10000}%, best of ${plan.quote.alternatives} route${plan.quote.alternatives === 1 ? "" : "s"}`}
                </span>
              </dd>
            </div>
            {plan.kind === "swap" && (
              <>
                <div>
                  <dt>Price impact</dt>
                  <dd className={`num ${plan.quote.impactPct > plan.limits.maxPriceImpactPct ? "value-neg" : "value-pos"}`}>
                    {plan.quote.impactPct.toFixed(2)}%
                    <span className="quote-sub">what the pool's depth costs you at this size</span>
                  </dd>
                </div>
                <div>
                  <dt>Minimum received</dt>
                  <dd className="num">
                    {Number(ethers.formatUnits(plan.amountOutMinimum, plan.to.decimals)).toFixed(6)} {plan.to.symbol}
                    <span className="quote-sub">after {plan.slippagePct}% slippage, or it reverts</span>
                  </dd>
                </div>
              </>
            )}
            {plan.cashValueDisplay != null && (
              <div>
                <dt>Value</dt>
                <dd className="num">
                  about ${plan.cashValueDisplay.toFixed(2)}
                  <span className="quote-sub">counted against your live trading caps</span>
                </dd>
              </div>
            )}
            {plan.gas && (
              <div>
                <dt>Network fee</dt>
                <dd className="num">
                  about {Number(ethers.formatEther(plan.gas.feeWei)).toFixed(6)} {chain.nativeSymbol}
                </dd>
              </div>
            )}
            {soldBack && (
              <div>
                <dt>Selling it straight back</dt>
                <dd className="num">
                  about {Number(ethers.formatUnits(soldBack.soldBack, plan.routeIn.decimals)).toFixed(6)} {plan.routeIn.symbol}
                  <span className="quote-sub">for the minimum received, in a simulation run before signing</span>
                </dd>
              </div>
            )}
          </dl>

          {to && !to.native && (
            <TokenProvenanceNotice
              token={to}
              chain={chain}
              checked={addressChecked}
              disabled={busy}
              onChange={(v) => {
                setAddressChecked(v);
                if (v) acknowledgeToken(chain.chainId, to.address);
              }}
            />
          )}

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
              <input type="checkbox" checked={impactAccepted} onChange={(e) => setImpactAccepted(e.target.checked)} />
              <span>
                <span className="toggle-title">I accept losing about {plan.quote.impactPct.toFixed(2)}% to price impact</span>
                <span className="muted small">This pool is thin at this size. A smaller amount would cost less.</span>
              </span>
            </label>
          )}

          {plan.needsSafetyAck && (
            <label className="toggle-row">
              <input type="checkbox" checked={safetyAccepted} disabled={busy} onChange={(e) => setSafetyAccepted(e.target.checked)} />
              <span>
                <span className="toggle-title">I accept that {plan.to.symbol} could not be checked for being sold again</span>
                <span className="muted small">Asked for this swap only. Tokens on the hand-checked list for this network do not need it.</span>
              </span>
            </label>
          )}

          <p className="settings-note">
            <ShieldCheck size={15} />
            {plan.needsApproval
              ? `Before the swap you must allow the exchange to move your ${plan.from.symbol}. That is a separate transaction, for exactly this amount rather than an open-ended allowance.`
              : "Your password decrypts the key in this browser to sign this one transaction, then it is discarded. Nothing is signed on our servers."}
          </p>
          <Field label="Wallet password">
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy} autoComplete="current-password" />
          </Field>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <Button variant="ghost" onClick={resetPlan} disabled={busy}>
              Change
            </Button>
            {plan.needsApproval ? (
              plan.needsAllowanceReset ? (
                <Button variant="primary" onClick={() => doApprove({ reset: true })} disabled={busy || !password || addressBlocking}>
                  {busy ? step || "Resetting…" : `Reset the ${plan.from.symbol} allowance to zero`}
                </Button>
              ) : (
                <Button variant="primary" onClick={() => doApprove()} disabled={busy || !password || blocked || addressBlocking || safetyBlocking}>
                  {busy ? step || "Approving…" : `Approve ${plan.from.symbol}`}
                </Button>
              )
            ) : (
              <Button
                variant="primary"
                onClick={doSwap}
                disabled={busy || !password || blocked || impactBlocking || addressBlocking || safetyBlocking}
              >
                {busy ? step || "Signing…" : plan.kind === "wrap" ? "Sign and wrap" : plan.kind === "unwrap" ? "Sign and unwrap" : "Sign and swap"}
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
