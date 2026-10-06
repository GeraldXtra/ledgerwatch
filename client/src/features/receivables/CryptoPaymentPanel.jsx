import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import { ArrowDownToLine, Ban, Check, Coins, Copy, ExternalLink, Hourglass, ShieldCheck, TriangleAlert } from "lucide-react";
import { Button, Input, SkeletonLines } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { getStoredAddress, hasWallet } from "../wallet/keystore";
import { verifyAddress } from "../wallet/derivation";
import ProgressBar from "./ProgressBar";
import SweepModal from "./SweepModal";
import { confirmationsFor } from "./confirmations";
import { fetchPaymentAddresses, revokePaymentAddress } from "./cryptoApi";
import {
  agoLabel,
  countdown,
  dateTime,
  ngn,
  shortDate,
  shortHash,
  usdc,
  usdcAmount,
} from "./format";

// Status of the address itself, as a pill tone the design system already knows.
const STATUS_TONE = {
  active: "scheduled",
  paid: "paid",
  expired: "cancelled",
  revoked: "cancelled",
  swept: "paid",
};

const STATUS_LABEL = {
  active: "Awaiting payment",
  paid: "Paid in full",
  expired: "Expired",
  revoked: "Revoked",
  swept: "Swept to wallet",
};

/**
 * The crypto payment address on an invoice: where to send, how much, how long
 * is left, and exactly what has arrived so far.
 *
 * The detected/confirmed distinction is the point of this panel. Money that has
 * landed on chain but is not yet deep enough to trust must be VISIBLE — telling
 * someone chasing a debt "nothing has arrived" while a transfer sits two blocks
 * deep would be false. So detected and confirmed are shown separately, in
 * different tones, and the confirmation count is spelled out against the depth
 * being waited for.
 */
export default function CryptoPaymentPanel({ debt, refreshKey = 0 }) {
  const { user } = useAuth();
  const [addresses, setAddresses] = useState(null);
  const [chains, setChains] = useState([]);
  // Today's rate, for comparison against each address's snapshot. The snapshot
  // still settles the invoice; this only makes the drift visible.
  const [currentRate, setCurrentRate] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const data = await fetchPaymentAddresses(debt._id);
      setAddresses(data.addresses || []);
      setChains(data.chains || []);
      setCurrentRate(data.currentRate || null);
      setError("");
    } catch (err) {
      setAddresses([]);
      const reason = err?.response?.data?.error || err?.message;
      setError(
        reason
          ? `Could not load the crypto payment details: ${reason}`
          : "Could not load the crypto payment details."
      );
    }
  }, [debt._id]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  /**
   * LIVE, WHILE THERE IS SOMETHING TO BE LIVE ABOUT. (LW-040, BUILD_PLAN P3-6.)
   *
   * The panel fetched once and never again. Everything on it that moves —
   * detected, confirmations climbing, settled — moved only in the database, so
   * the owner watched a frozen screen while a payment confirmed and had no way
   * to know anything had happened short of reloading the page. Paired with
   * LW-041 (the depth shown was also wrong) the payment screen read as broken
   * while working correctly.
   *
   * Polled rather than pushed: there is no socket layer here and adding one for
   * this would be a large change for a screen somebody has open for a few
   * minutes. The cost is bounded by only polling when it can change anything:
   *
   *   - an address still ACTIVE or EXPIRED (a terminal one cannot move), AND
   *   - either a transfer is part way to confirming, or nothing has arrived yet.
   *
   * A settled invoice with nothing outstanding polls not at all, which is the
   * common case for an old invoice somebody happens to open.
   */
  const needsLiveUpdates = (addresses || []).some((pa) => {
    if (pa.status !== "active" && pa.status !== "expired") return false;
    const observed = pa.observed || [];
    const confirming = observed.some((o) => o.status === "detected");
    const nothingYet = observed.length === 0;
    return confirming || nothingYet;
  });

  useEffect(() => {
    if (!needsLiveUpdates) return undefined;

    // Twelve seconds. Fast enough that a confirmation appears while the owner is
    // still looking, slow enough that a page left open all day costs a few
    // hundred requests rather than a few thousand.
    const id = setInterval(() => {
      // Not while the tab is in the background: a backgrounded tab polling for
      // hours is the shape that gets an account rate limited for no benefit.
      if (typeof document !== "undefined" && document.hidden) return;
      load();
    }, 12000);
    return () => clearInterval(id);
  }, [needsLiveUpdates, load]);

  /**
   * Catch up the moment the tab comes back. Somebody who switches away, pays
   * from their phone and switches back should see the result immediately rather
   * than after the next tick.
   */
  useEffect(() => {
    if (!needsLiveUpdates || typeof document === "undefined") return undefined;
    const onVisible = () => {
      if (!document.hidden) load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [needsLiveUpdates, load]);

  if (addresses === null) return <SkeletonLines count={3} />;
  if (error) {
    return (
      <p className="error-text" style={{ margin: 0 }}>
        {error}
      </p>
    );
  }
  if (addresses.length === 0) return null;

  return (
    <div className="stack-sm">
      <span className="overline">Crypto payment</span>
      {addresses.map((pa) => (
        <AddressCard
          key={pa._id}
          pa={pa}
          chain={chains.find((c) => c.chainId === pa.chainId) || null}
          onChanged={load}
          sweepDestination={user?.crypto?.sweepDestination || null}
          // The depth the WATCHER waits for on this chain, including this
          // account's own override. Computed once here from the same table and
          // the same clamp the server uses, rather than each card guessing.
          confirmationsNeeded={confirmationsFor(pa.chainId, user)}
          // Loaded once for the whole panel and shared by every card, rather
          // than each card fetching today's rate for itself.
          currentRate={currentRate}
        />
      ))}
    </div>
  );
}

function AddressCard({
  pa,
  chain,
  onChanged,
  sweepDestination,
  currentRate = null,
  confirmationsNeeded = null,
}) {
  const [qr, setQr] = useState("");
  // The owner-initiated address check. See the control further down for why this
  // is offered rather than run on render.
  const [verifying, setVerifying] = useState(false);
  const [verifyPassword, setVerifyPassword] = useState("");
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [verifyResult, setVerifyResult] = useState(null);
  const [copied, setCopied] = useState(false);
  const [left, setLeft] = useState(() => countdown(pa.expiresAt));
  const [revoking, setRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState("");
  const [sweepOpen, setSweepOpen] = useState(false);

  const isActive = pa.status === "active";

  // After expiry the address drops to a low-frequency grace watch rather than
  // being abandoned, so late money is still detected and credited. Mirrors
  // PAYMENT_GRACE_DAYS on the server.
  const GRACE_DAYS = 30;
  const graceUntil = pa.expiredAt
    ? new Date(new Date(pa.expiredAt).getTime() + GRACE_DAYS * 86400000)
    : null;
  const inGrace = pa.status === "expired" && graceUntil && graceUntil > new Date();

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(pa.address, {
      width: 220,
      margin: 1,
      color: { dark: "#0A1428", light: "#FFFFFF" },
    })
      .then((url) => {
        if (active) setQr(url);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [pa.address]);

  // Live countdown, ticking once a second and cleared on unmount. Only runs
  // while the address is actually active — there is nothing to count down to on
  // one that is already paid, expired or revoked.
  useEffect(() => {
    if (!isActive) return undefined;
    setLeft(countdown(pa.expiresAt));
    const id = setInterval(() => setLeft(countdown(pa.expiresAt)), 1000);
    return () => clearInterval(id);
  }, [pa.expiresAt, isActive]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(pa.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — the address is on screen to copy by hand */
    }
  }

  async function revoke() {
    if (
      !window.confirm(
        "Stop watching this address? Anything sent to it afterwards will not be matched to this invoice automatically."
      )
    ) {
      return;
    }
    setRevoking(true);
    setRevokeError("");
    try {
      await revokePaymentAddress(pa._id);
      await onChanged();
    } catch (err) {
      /**
       * THE OLD CATCH WAS EMPTY AND ITS COMMENT SAID "the panel reloads either
       * way". It did not: the reload is the line above, inside the try, so a
       * failed revoke skipped it. The owner got no error, no refresh and a card
       * still reading "Awaiting payment" — which was true, because the address
       * was still active and still being watched, while they believed they had
       * stopped it. The failure is now stated on the card, and the panel is
       * reloaded so the status shown is the server's, not a guess.
       */
      setRevokeError(
        err?.response?.data?.error ||
          "The address could not be revoked, so it is still active and still being watched. Try again."
      );
      await onChanged().catch(() => {
        /* the message above already says the address is still active */
      });
    } finally {
      setRevoking(false);
    }
  }

  const observed = pa.observed || [];
  const confirmedTxs = observed.filter((t) => t.status === "confirmed");
  const detectedTxs = observed.filter((t) => t.status === "detected");
  const orphanedTxs = observed.filter((t) => t.status === "orphaned");

  // `receivedUsdc` counts CONFIRMED money only — that is what has settled
  // against the invoice. Detected money is totalled separately so it can be
  // shown as incoming without being counted as received.
  const received = Number(pa.receivedUsdc) || 0;
  const expected = Number(pa.expectedUsdc) || 0;
  const pending = detectedTxs.reduce((sum, t) => sum + unitsToNumber(t.value, pa.tokenDecimals), 0);

  /**
   * ONE BASIS. This is LW-004 again, on the screen instead of in the ledger.
   *
   * `receivedUsdc` is CUMULATIVE — the running total of every confirmed transfer
   * this address has ever seen. `expectedUsdc` is REMAINING —
   * `resyncActivePaymentAddress` rewrites it after each partial settlement to
   * what is still owed. Subtracting one from the other mixes the two, exactly as
   * the server's `fullyPaid` check used to, and it is wrong in the dangerous
   * direction: after any part payment the difference goes negative and clamps to
   * zero, so the panel announced "Still needed: Nothing" on an invoice that was
   * still owed money.
   *
   * Worked example. A NGN 100,000 invoice at 1,600 asks for 62.50 USDC. The payer
   * sends 40. That settles NGN 64,000, resync rewrites expectedUsdc to 22.50, and
   * receivedUsdc is 40. The old line computed max(0, 22.50 - 40) = 0.
   *
   * The correct comparison is the server's: what has arrived and NOT yet been
   * turned into a Payment, against what is still expected. `settledPaymentId` is
   * stamped on each observed transfer as it settles, so the browser can compute
   * the same figure the watcher does. See `settleIfDue` in paymentWatch.service.js.
   */
  const unsettled = confirmedTxs
    .filter((t) => !t.settledPaymentId)
    .reduce((sum, t) => sum + unitsToNumber(t.value, pa.tokenDecimals), 0);
  const stillNeeded = Math.max(0, Math.round((expected - unsettled) * 100) / 100);

  // The unit on the three figure tiles. `tokenSymbol` is stored on the address
  // itself and is the token the payer was told to send; "USDC" was hardcoded
  // here, which mislabels every USDT invoice.
  const unit = pa.tokenSymbol || "USDC";

  /**
   * Offered whenever there is a wallet in this browser and an index to check
   * against. Whether that wallet can actually derive children is not knowable
   * without unlocking it — `canDerive` needs an already-unlocked wallet — so a
   * key-imported wallet is caught by `deriveAddress`, which throws a sentence
   * saying exactly that, and the catch below shows it.
   */
  const canVerify = hasWallet() && pa.derivationIndex != null;

  const explorerTx = (hash) => (chain?.explorer ? `${chain.explorer}/tx/${hash}` : null);
  const explorerAddress = chain?.explorer ? `${chain.explorer}/address/${pa.address}` : null;

  return (
    <div className="crypto-card">
      <div className="row space-between wrap crypto-card-head">
        <div className="row wrap">
          <span className="icon-tile">
            <Coins size={16} />
          </span>
          <div>
            <div className="card-title">{chain ? chain.name : `Chain ${pa.chainId}`}</div>
            <div className="muted caption">
              {pa.tokenSymbol} only · issued {agoLabel(pa.createdAt)}
            </div>
          </div>
        </div>
        <div className="row wrap">
          {/* A hardcoded "Testnet" badge sat here, on the panel that shows the
              address a real payer is given. On a mainnet address it labelled
              real money as practice. Removed rather than made conditional: the
              chain name is already the card title. */}
          <span className={`pill ${STATUS_TONE[pa.status] || "pending"}`}>
            <span className="pill-dot" />
            {STATUS_LABEL[pa.status] || pa.status}
          </span>
        </div>
      </div>

      <div className="crypto-card-body">
        <div className="crypto-qr-col">
          {qr ? (
            <img src={qr} alt={`QR code for ${pa.address}`} className="receive-qr" />
          ) : (
            <div className="receive-qr receive-qr-empty" />
          )}
          <code className="wallet-address">{pa.address}</code>
          <div className="row wrap" style={{ justifyContent: "center" }}>
            <Button variant="secondary" size="sm" onClick={copy}>
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? "Copied" : "Copy address"}
            </Button>
            {explorerAddress && (
              <a
                className="btn btn-ghost btn-sm"
                href={explorerAddress}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink size={14} /> Explorer
              </a>
            )}
            {/*
              SECURITY.md 4.1 item 15: "A payment address is shown to a payer
              only after verifyAddress() re-derives and matches."

              `verifyAddress` was written for this and had zero call sites, so
              the check existed only at issuance, inside the modal that created
              the address. Every later viewing of the invoice — which is where
              the owner actually copies the address and sends it to a customer,
              and where the QR is scanned — rendered whatever the server
              returned, on trust.

              It cannot run on render: re-deriving needs the keystore password,
              and demanding one to look at an invoice would be unusable. So it
              is offered instead of assumed. The owner can prove, at any time and
              without trusting this server, that the address on screen is one
              their own recovery phrase controls.
            */}
            {canVerify && (
              <Button variant="ghost" size="sm" onClick={() => setVerifying(true)}>
                <ShieldCheck size={14} /> Check it is mine
              </Button>
            )}
          </div>

          {verifyResult && (
            <p
              className={
                verifyResult.ok ? "caption value-pos" : "settings-note danger"
              }
              style={{ marginTop: 8 }}
            >
              {verifyResult.message}
            </p>
          )}

          {verifying && (
            <form
              className="stack-tight"
              style={{ marginTop: 10 }}
              onSubmit={async (e) => {
                e.preventDefault();
                setVerifyBusy(true);
                setVerifyResult(null);
                try {
                  const ok = await verifyAddress(
                    verifyPassword,
                    pa.derivationIndex,
                    pa.address
                  );
                  setVerifyResult(
                    ok
                      ? {
                          ok: true,
                          message:
                            "Confirmed. This address was derived from your own recovery phrase, " +
                            "so anything sent to it is yours.",
                        }
                      : {
                          // The case this whole control exists for. Do not soften it.
                          ok: false,
                          message:
                            "This address does NOT match what your wallet derives at this index. " +
                            "Do not give it to anyone. Revoke it and issue a new one.",
                        }
                  );
                  setVerifying(false);
                  setVerifyPassword("");
                } catch (err) {
                  // A wrong password is the ordinary case and must not read as a
                  // mismatch: "we could not check" is not "it is wrong".
                  setVerifyResult({
                    ok: false,
                    message:
                      /password|decrypt/i.test(err?.message || "")
                        ? "That password did not open your wallet, so the address was not checked."
                        : `The address could not be checked: ${err?.message || "unknown error"}.`,
                  });
                } finally {
                  setVerifyBusy(false);
                }
              }}
            >
              <Input
                type="password"
                value={verifyPassword}
                onChange={(e) => setVerifyPassword(e.target.value)}
                placeholder="Wallet password"
                autoFocus
              />
              <div className="row wrap">
                <Button type="submit" size="sm" disabled={verifyBusy || !verifyPassword}>
                  {verifyBusy ? "Checking…" : "Check"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setVerifying(false);
                    setVerifyPassword("");
                  }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          )}
        </div>

        <div className="crypto-detail-col">
          <dl className="trade-quote">
            <div>
              <dt>Amount requested</dt>
              <dd className="num">
                {usdc(expected, pa.tokenSymbol)}
                <span className="quote-sub">in {pa.tokenSymbol || "USDC"}</span>
                {/*
                  WHAT THE PAYER WAS ASKED FOR, when it is no longer what is
                  owed. `expectedUsdc` follows the balance and is rewritten every
                  time anything settles; `quote.expectedUsdc` is what this
                  address was ISSUED for and never changes. Showing both is the
                  difference between "they underpaid" and "they paid exactly what
                  we told them, and a bank transfer arrived in between".
                */}
                {pa.quote &&
                  pa.quote.expectedUsdc != null &&
                  Math.abs(pa.quote.expectedUsdc - expected) > 0.004 && (
                    <span className="quote-sub">
                      quoted {usdc(pa.quote.expectedUsdc, pa.tokenSymbol)} when issued
                      {pa.quote.reconstructed ? " (reconstructed)" : ""}
                    </span>
                  )}
              </dd>
            </div>
            <div>
              <dt>Naira equivalent</dt>
              <dd className="num">
                {ngn(pa.invoiceBalanceNgn)}
                <span className="quote-sub">
                  at {ngn(pa.ngnPerUsd)} per {pa.tokenSymbol || "USDC"},{" "}
                  {/* See the same note in CryptoPaymentModal: a fallback rate is
                      stamped with the issuance time, so "just now" was misleading. */}
                  {pa.rateIsFallback ? "fallback rate, not live" : agoLabel(pa.rateTimestamp)}
                </span>
                {/* SNAPSHOT vs CURRENT. The snapshot is what settles this invoice
                    settles this invoice. A payer who sends what they were quoted clears it whatever
                    the naira does. The owner still needs to see how far the rate
                    has moved, so both are shown and the drift is named. Withheld
                    below 0.5% because a rate always wobbles slightly and flagging
                    noise would train people to ignore it. */}
                {!currentRate || !(currentRate.ngnPerUsd > 0) ? (
                  /* Today's rate could not be read. Said out loud rather than
                     omitted: an absent comparison looks identical to "the rate
                     has not moved", which is a claim we cannot make. The
                     snapshot above is unaffected and still settles the invoice. */
                  <span className="quote-sub">
                    Today&rsquo;s rate is unavailable, so no comparison is shown. This invoice is
                    unaffected. It settles at the rate above.
                  </span>
                ) : (
                  pa.ngnPerUsd > 0 &&
                  Math.abs(currentRate.ngnPerUsd - pa.ngnPerUsd) / pa.ngnPerUsd > 0.005 && (
                    <span className="quote-sub rate-drift">
                      now {ngn(currentRate.ngnPerUsd)} (
                      {currentRate.ngnPerUsd > pa.ngnPerUsd ? "+" : ""}
                      {(((currentRate.ngnPerUsd - pa.ngnPerUsd) / pa.ngnPerUsd) * 100).toFixed(1)}%)
                      {". This invoice still settles at the rate above"}
                    </span>
                  )
                )}
              </dd>
            </div>
            <div>
              <dt>{isActive ? "Expires in" : "Expired"}</dt>
              <dd className="num">
                {isActive ? (
                  left ? (
                    <>
                      <Hourglass size={13} style={{ verticalAlign: "-2px", marginRight: 5 }} />
                      {left}
                    </>
                  ) : (
                    "Expiring now"
                  )
                ) : (
                  dateTime(pa.expiresAt)
                )}
                {/* Watching does not stop at expiry. Money sent late is still
                    found and credited, so say so rather than leaving the payer's
                    position looking hopeless. */}
                {inGrace && (
                  <span className="quote-sub">
                    still watching for late payments until {shortDate(graceUntil)}
                  </span>
                )}
              </dd>
            </div>
          </dl>

          {/**
            * TWO DIFFERENT FACTS THAT WERE BEING TOLD AS ONE.
            *
            * The watcher sets `unidentifiedBalanceAt` in two unrelated cases: a
            * balance no transfer in the searchable window explains, and money
            * that arrived when the invoice owed nothing (LW-002's UNATTRIBUTED
            * outcome, which also writes `unattributedUsdc`). Only the first
            * banner existed, so an unattributed arrival was reported as a
            * searching limitation — a sentence that is simply false when the
            * transaction is listed, confirmed, a few lines below with an
            * explorer link. The amount, which is the one thing the owner needs,
            * was never shown at all: it appeared nowhere in the client.
            *
            * So the unattributed case is stated on its own terms, with the
            * figure, and the older-than-the-window sentence is kept for the case
            * it was actually written about.
            */}
          {pa.unattributedUsdc > 0 && (
            <p className="settings-note danger">
              <TriangleAlert size={15} />
              {usdc(pa.unattributedUsdc, pa.tokenSymbol)} arrived here when this invoice owed
              nothing, so it was not credited to it
              {pa.unattributedAt ? ` (${dateTime(pa.unattributedAt)})` : ""}. The money is safe at
              this address, which is derived from your own wallet, and you can sweep it into your
              wallet below.
            </p>
          )}
          {pa.unidentifiedBalanceAt && !(pa.unattributedUsdc > 0) && (
            <p className="settings-note danger">
              <TriangleAlert size={15} />
              This address is holding more than the transfers listed below account for. The funds
              are real and visible on the block explorer, but the transaction that sent them is
              older than the recent window we can search, so it could not be matched
              automatically.
            </p>
          )}

          <div className="crypto-progress">
            <div className="row space-between crypto-progress-head">
              <span className="overline">Confirmed against what is still owed</span>
              {/* The token this address accepts, never the literal "USDC": an
                  invoice can be issued in USDT wherever a verified contract
                  exists, and a payer told the wrong symbol sends the wrong token
                  to a real address. See the note on `usdc` in format.js. */}
              <span className="num mono-strong">
                {usdcAmount(unsettled)} of {usdc(expected, pa.tokenSymbol)}
              </span>
            </div>
            {/* Both figures on the SAME basis — see the note beside `unsettled`.
                This read `received` (cumulative) against `expected` (remaining),
                so after a part payment the bar showed more than full. */}
            <ProgressBar paid={unsettled} total={expected || 1} />
            {/* The unit sits on its own line in these tiles. Each one has only
                about 100px of width inside this modal, and "36,799.89 USDC" on a
                single line needs very nearly all of it. */}
            <div className="crypto-progress-figures">
              <div className="crypto-figure">
                <span className="overline">Received</span>
                <span className="num mono-strong value-pos">
                  {usdcAmount(received)}
                  <span className="figure-unit">{unit}</span>
                </span>
              </div>
              <div className="crypto-figure">
                <span className="overline">Incoming, unconfirmed</span>
                <span className={`num mono-strong ${pending > 0 ? "value-warn" : ""}`}>
                  {usdcAmount(pending)}
                  <span className="figure-unit">{unit}</span>
                </span>
              </div>
              <div className="crypto-figure">
                <span className="overline">Still needed</span>
                <span className={`num mono-strong ${stillNeeded > 0 ? "value-neg" : "value-pos"}`}>
                  {stillNeeded > 0 ? (
                    <>
                      {usdcAmount(stillNeeded)}
                      <span className="figure-unit">{unit}</span>
                    </>
                  ) : (
                    "Nothing"
                  )}
                </span>
              </div>
            </div>
          </div>

          {pa.overpaidUsdc > 0 && (
            <p className="settings-note">
              <TriangleAlert size={15} />
              {usdc(pa.overpaidUsdc, pa.tokenSymbol)} more than the invoice asked for arrived. The invoice is
              settled in full and the excess is recorded here.
            </p>
          )}
        </div>
      </div>

      {observed.length === 0 && (pa.foreign || []).length === 0 ? (
        <p className="muted small crypto-empty">
          Nothing has arrived yet. Incoming transfers appear here as soon as they are seen on
          chain, before they are deep enough to settle.
        </p>
      ) : (
        <ul className="tx-list crypto-tx-list">
          {[...detectedTxs, ...confirmedTxs, ...orphanedTxs].map((t) => (
            <li key={t.txHash} className="row space-between crypto-tx-row">
              <div className="row">
                <span className={`icon-tile ${t.status === "confirmed" ? "pos" : t.status === "orphaned" ? "neg" : "neutral"}`}>
                  {t.status === "confirmed" ? (
                    <Check size={15} />
                  ) : t.status === "orphaned" ? (
                    <Ban size={15} />
                  ) : (
                    <Hourglass size={15} />
                  )}
                </span>
                <div>
                  <div className="num mono-strong">
                    {usdc(unitsToNumber(t.value, pa.tokenDecimals), pa.tokenSymbol)}
                  </div>
                  <div className="muted caption">
                    {t.status === "confirmed" && (
                      <>Confirmed{t.confirmedAt ? ` · ${dateTime(t.confirmedAt)}` : ""}</>
                    )}
                    {t.status === "detected" &&
                      (confirmationsNeeded ? (
                        <>
                          Detected · {t.confirmations || 0} of {confirmationsNeeded} confirmations
                        </>
                      ) : (
                        /* An unrecognised chain. Stating a target we do not know
                           would be a guess about how long the payer has to wait,
                           so only the count that is actually true is shown. */
                        <>Detected · {t.confirmations || 0} confirmations so far</>
                      ))}
                    {t.status === "orphaned" && <>Vanished in a reorg · not counted</>}
                  </div>
                </div>
              </div>
              <div className="row">
                {/* Late money still counts and still settles, at the rate the
                    payer was originally quoted. Flagged so a settlement on an
                    invoice that looked closed is never a surprise. */}
                {t.late && <span className="pill warn">Late</span>}
                <span className={`pill ${txTone(t.status)}`}>
                  <span className="pill-dot" />
                  {t.status === "confirmed"
                    ? "Confirmed"
                    : t.status === "orphaned"
                    ? "Orphaned"
                    : "Detected"}
                </span>
                {explorerTx(t.txHash) ? (
                  <a
                    className="tx-hash-link"
                    href={explorerTx(t.txHash)}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={t.txHash}
                  >
                    {shortHash(t.txHash)} <ExternalLink size={12} />
                  </a>
                ) : (
                  <code className="muted caption">{shortHash(t.txHash)}</code>
                )}
              </div>
            </li>
          ))}

          {(pa.foreign || []).map((f) => (
            <li key={f.txHash} className="row space-between crypto-tx-row">
              <div className="row">
                <span className="icon-tile neg">
                  <TriangleAlert size={15} />
                </span>
                <div>
                  <div className="card-title">Wrong token sent</div>
                  <div className="muted caption">
                    A transfer of something other than {pa.tokenSymbol} arrived. It does not
                    settle this invoice.
                  </div>
                </div>
              </div>
              {explorerTx(f.txHash) ? (
                <a
                  className="tx-hash-link"
                  href={explorerTx(f.txHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={f.txHash}
                >
                  {shortHash(f.txHash)} <ExternalLink size={12} />
                </a>
              ) : (
                <code className="muted caption">{shortHash(f.txHash)}</code>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="crypto-card-foot">
        <p className="settings-note danger" style={{ margin: 0 }}>
          <TriangleAlert size={15} />
          Send {pa.tokenSymbol} on {chain ? chain.name : "this network"} only. Any other token,
          or the right token on the wrong network, is lost permanently and cannot be recovered by
          anyone.
        </p>
        <div className="row">
          {/* Sweeping is offered whenever money has actually arrived, whatever the
              address status: a revoked or expired address can still be holding
              funds, and stranding them would be the worse outcome. */}
          {received > 0 && hasWallet() && (
            <Button variant="secondary" size="sm" onClick={() => setSweepOpen(true)}>
              <ArrowDownToLine size={14} /> Sweep to wallet
            </Button>
          )}
          {isActive && (
            <Button variant="ghost" size="sm" onClick={revoke} disabled={revoking}>
              <Ban size={14} /> {revoking ? "Revoking…" : "Revoke address"}
            </Button>
          )}
        </div>
        {revokeError && (
          <p className="error-text" style={{ margin: 0 }}>
            {revokeError}
          </p>
        )}
      </div>

      {sweepOpen && (
        <SweepModal
          addresses={[pa]}
          chains={chain ? [chain] : []}
          mainAddress={getStoredAddress()}
          // Settings may name somewhere other than this device's wallet; the
          // modal warns when the two differ.
          destination={sweepDestination || getStoredAddress()}
          onClose={() => setSweepOpen(false)}
          onDone={onChanged}
        />
      )}
    </div>
  );
}

function txTone(status) {
  if (status === "confirmed") return "paid";
  if (status === "orphaned") return "cancelled";
  return "pending";
}

/**
 * Raw token units -> a display number. Uses BigInt for the integer part because
 * a raw 18-decimal value exceeds IEEE-754 integer safety; USDC's 6 decimals
 * would survive Number(), but this must stay correct if another token is ever
 * configured.
 */
function unitsToNumber(raw, decimals = 6) {
  try {
    const d = BigInt(Math.max(0, Number(decimals) || 0));
    const scale = 10n ** d;
    const v = BigInt(String(raw || "0"));
    const whole = v / scale;
    const frac = v % scale;
    return Number(whole) + Number(frac) / Number(scale);
  } catch {
    return 0;
  }
}
