import { useEffect, useState } from "react";
import { ethers } from "ethers";
import { ExternalLink, ShieldCheck, TriangleAlert, X } from "lucide-react";
import { Button, Field, Input, Modal, SkeletonLines, useToast } from "../../components/ui";
import http from "../../api/http";
import { useAuth } from "../../context/AuthContext";
import GasNotice from "../wallet/GasNotice";
import { approveRouter, executeSwap, planSwap } from "./liveSwap";
import TokenProvenanceNotice, {
  acknowledgeToken,
  isTokenAcknowledged,
  needsAcknowledgement,
} from "./TokenProvenanceNotice";

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
 *
 * AND IT DID NOT ROUND DOWN. The arithmetic was `Math.floor(n * 10 ** decimals)
 * / 10 ** decimals`, then `toFixed(decimals)`. For an 18 decimal token
 * `10 ** 18` is past Number.MAX_SAFE_INTEGER, so the floor is a no-op and
 * `toFixed(18)` then re-expands the binary error that a double carries: 0.1
 * produced 100000000000000006 units against an exact 100000000000000000, and
 * 1234.5678 produced about 34,000 units too many. Small in value, wrong in
 * direction, and `planSwap` compares the result against the on-chain balance —
 * so "sell everything" answered "You hold 0.1000 X and this trade needs 0.1",
 * a refusal that contradicts itself and leaves no way forward.
 *
 * The fix works on the DECIMAL STRING rather than on the float. `String(n)` is
 * the shortest representation that round-trips, which is "0.1" and not the
 * binary value 0.1 actually is, and truncating that string can only ever remove
 * value. Exponential form is the one case a double writes without a decimal
 * point, so it is expanded with two spare digits and then truncated like the
 * rest, which keeps the direction right there too.
 */
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
  // Why `spentToday` is missing, when it is. Empty while the figure is still
  // being fetched; a sentence once the fetch has failed.
  spentTodayError = "",
  onRetrySpentToday,
  /**
   * What the resolver wants said about WHERE this contract came from — a symbol
   * that differs from the listing, a ticker shared with a different verified
   * token, a double-check that could not be completed. These were toasted on the
   * page behind this dialog and were gone by the time the address was on screen.
   */
  resolveWarnings = [],
  limitOverrides,
  onClose,
  onDone,
}) {
  const toast = useToast();
  const { user, refreshUser } = useAuth();

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
  // Bumped to ask for a fresh plan. A busy network is now an ordinary answer
  // rather than a dead end, so there has to be a way to ask again.
  const [replan, setReplan] = useState(0);

  /**
   * Has the owner looked at this contract's address?
   *
   * `token` here is the ASSET side of the trade in both directions — buying it
   * or selling it — which is the side whose address came from outside. The cash
   * side is always a registry stablecoin. Seeded from the per-browser record so
   * a token already checked does not ask again.
   */
  const [addressChecked, setAddressChecked] = useState(() =>
    isTokenAcknowledged(chain?.chainId, token?.address)
  );

  useEffect(() => {
    let live = true;
    setPlan(null);
    setPlanError("");
    /**
     * A TICK ACCEPTED FOR ONE IMPACT FIGURE DOES NOT CARRY TO THE NEXT.
     *
     * `impactAccepted` was set once and never reset. Changing the slippage or
     * pressing "Try again" re-plans from scratch, so a completely fresh quote —
     * with a possibly much worse price impact — arrived with the acceptance box
     * already ticked and the sign button already enabled. The label updated to
     * the new percentage; the consent was given for a number the user never saw.
     * Hard rule 2 wants a confirmation per transaction, and this is where the
     * transaction changes.
     */
    setImpactAccepted(false);
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
  }, [slippage, spentToday, replan]);

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
      // Same reason as in the plan effect: this is a fresh quote with a freshly
      // measured impact, so a tick given for the previous one does not stand.
      setImpactAccepted(false);
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

      /**
       * REMEMBER WHAT WAS JUST BOUGHT, OR IT CANNOT BE SOLD.
       *
       * The universal resolver lets a live buy reach any token on the chain, not
       * just the dozen the registry carries. But nothing recorded the result, so
       * the moment the swap landed the asset was invisible: absent from the live
       * portfolio (which lists registry tokens plus the user's own), absent from
       * the wallet's Send form, and with no row to sell from. Real money spent on
       * something the product could then neither show nor exit.
       *
       * Adding it to the user's own token list is the existing mechanism for
       * exactly this, and it is what "add by address in the wallet" already does
       * by hand. Only on a BUY: a sell reduces a position that is already known.
       */
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

      // The trade happened but this app could not write it down. Said here
      // because the daily spend cap is computed from exactly those rows, so a
      // missing one silently raises the ceiling. See executeSwap.
      if (res && res.recorded === false) {
        toast(
          "The trade went through, but it could not be saved to your history. It will not " +
            "count towards today's spending limit. Transaction " + String(res.txHash).slice(0, 10) + "…",
          { type: "error", duration: 14000 }
        );
      }

      /**
       * CLOSE THE ALERT. The swap is on chain; the alert that prompted it was
       * still `pending`, and the price pass will not raise another alert on a
       * watch that has one waiting — so without this, every live watch alerted
       * exactly once and then went quiet forever.
       *
       * After the swap on purpose: the trade is the thing that matters and it
       * has already happened. A failure here is reported, never thrown, because
       * unwinding is not possible and presenting a completed trade as a failure
       * would be worse than an alert left open.
       */
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
  // An index-sourced contract cannot be signed for until it has been looked at.
  const addressBlocking = needsAcknowledgement(token) && !addressChecked;

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
      ) : spentToday == null && spentTodayError ? (
        /**
         * THE DAILY SPEND FIGURE COULD NOT BE READ.
         *
         * Refusing to quote without it is right — the daily cap is checked
         * against it, and planning against an assumed zero is how a cap stops
         * being a cap. But this state was indistinguishable from "still
         * loading", so a single failed request left four grey bars on screen
         * with no error, no retry and no way out but the close cross. That is
         * LW-037's shape, in the same file, arriving through the daily-cap work.
         */
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
        /**
         * A PLAN THAT NEVER GOT A PRICE.
         *
         * `planSwap` returns early, with `blocks` and no `quote`, when there is
         * no pool for the pair and now also when the route search could not be
         * completed. Every branch below this one dereferences `plan.quote`, so
         * without this the dialog threw on render and showed nothing at all —
         * the user asked to buy something and got an empty box, which reads as
         * the app being broken rather than as an answer.
         *
         * That was already true for the no-pool case. It became urgent with the
         * incomplete-search case, because a busy network is common where a
         * missing pool is rare.
         */
        <>
          {plan.blocks.map((b, i) => (
            <div className="against-note" key={i}>
              <TriangleAlert size={15} />
              <span>{b}</span>
            </div>
          ))}
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <Button variant="ghost" onClick={onClose}>Close</Button>
            {/* A counter, not `setSlippage(s => s)`: React bails out of a state
                update that is Object.is-equal to the current value, so setting
                slippage to itself would re-render nothing and the button would
                do exactly nothing, quietly. */}
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
                {/* Says which ROUTE won, not just which tier. Most tokens are
                    paired against the chain's own coin rather than a dollar, so
                    the winning route is often two hops, and a line that only
                    named a fee tier would describe a trade that is not the one
                    being signed. */}
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

          {/* WHAT THE RESOLVER WANTED SAID ABOUT THIS CONTRACT, said here.
              These were toasts raised on the page behind this dialog, eleven
              seconds before it opened, so the sentence explaining why the
              address is worth checking had disappeared by the time the address
              was on screen and the tick box below was being considered. */}
          {(resolveWarnings || []).map((w, i) => (
            <div className="against-note" key={`rw${i}`}>
              <TriangleAlert size={15} />
              <span>{w}</span>
            </div>
          ))}

          {/* Above the blocks and the gas note: it is about WHAT is being
              bought, which has to be settled before anything about price. */}
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
                <Button
                  variant="primary"
                  onClick={doApprove}
                  disabled={busy || !password || blocked || addressBlocking}
                >
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
                  disabled={busy || !password || blocked || impactBlocking || addressBlocking}
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
