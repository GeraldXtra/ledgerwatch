import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import {
  ArrowDownToLine,
  Check,
  Coins,
  Copy,
  ExternalLink,
  Hourglass,
  Ban,
  TriangleAlert,
} from "lucide-react";
import { Button, SkeletonLines } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { getStoredAddress, hasWallet } from "../wallet/keystore";
import ProgressBar from "./ProgressBar";
import SweepModal from "./SweepModal";
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
          // Loaded once for the whole panel and shared by every card, rather
          // than each card fetching today's rate for itself.
          currentRate={currentRate}
        />
      ))}
    </div>
  );
}

function AddressCard({ pa, chain, onChanged, sweepDestination, currentRate = null }) {
  const [qr, setQr] = useState("");
  const [copied, setCopied] = useState(false);
  const [left, setLeft] = useState(() => countdown(pa.expiresAt));
  const [revoking, setRevoking] = useState(false);
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
    try {
      await revokePaymentAddress(pa._id);
      await onChanged();
    } catch {
      /* the panel reloads either way; a failed revoke leaves it active */
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
  const stillNeeded = Math.max(0, Math.round((expected - received) * 100) / 100);

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
          <span className="testnet-badge">Testnet</span>
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
          </div>
        </div>

        <div className="crypto-detail-col">
          <dl className="trade-quote">
            <div>
              <dt>Amount requested</dt>
              <dd className="num">
                {usdc(expected, pa.tokenSymbol)}
                <span className="quote-sub">in {pa.tokenSymbol || "USDC"}</span>
              </dd>
            </div>
            <div>
              <dt>Naira equivalent</dt>
              <dd className="num">
                {ngn(pa.invoiceBalanceNgn)}
                <span className="quote-sub">
                  at {ngn(pa.ngnPerUsd)} per {pa.tokenSymbol || "USDC"}, {agoLabel(pa.rateTimestamp)}
                </span>
                {/* SNAPSHOT vs CURRENT. The snapshot is what settles this invoice
                    — a payer who sends what they were quoted clears it whatever
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
                    unaffected — it settles at the rate above.
                  </span>
                ) : (
                  pa.ngnPerUsd > 0 &&
                  Math.abs(currentRate.ngnPerUsd - pa.ngnPerUsd) / pa.ngnPerUsd > 0.005 && (
                    <span className="quote-sub rate-drift">
                      now {ngn(currentRate.ngnPerUsd)} (
                      {currentRate.ngnPerUsd > pa.ngnPerUsd ? "+" : ""}
                      {(((currentRate.ngnPerUsd - pa.ngnPerUsd) / pa.ngnPerUsd) * 100).toFixed(1)}%)
                      {" — this invoice still settles at the rate above"}
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

          {pa.unidentifiedBalanceAt && (
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
              <span className="overline">Confirmed and settled</span>
              <span className="num mono-strong">
                {usdcAmount(received)} of {usdc(expected)}
              </span>
            </div>
            <ProgressBar paid={received} total={expected || 1} />
            {/* The unit sits on its own line in these tiles. Each one has only
                about 100px of width inside this modal, and "36,799.89 USDC" on a
                single line needs very nearly all of it. */}
            <div className="crypto-progress-figures">
              <div className="crypto-figure">
                <span className="overline">Received</span>
                <span className="num mono-strong value-pos">
                  {usdcAmount(received)}
                  <span className="figure-unit">USDC</span>
                </span>
              </div>
              <div className="crypto-figure">
                <span className="overline">Incoming, unconfirmed</span>
                <span className={`num mono-strong ${pending > 0 ? "value-warn" : ""}`}>
                  {usdcAmount(pending)}
                  <span className="figure-unit">USDC</span>
                </span>
              </div>
              <div className="crypto-figure">
                <span className="overline">Still needed</span>
                <span className={`num mono-strong ${stillNeeded > 0 ? "value-neg" : "value-pos"}`}>
                  {stillNeeded > 0 ? (
                    <>
                      {usdcAmount(stillNeeded)}
                      <span className="figure-unit">USDC</span>
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
                    {t.status === "detected" && (
                      <>
                        Detected · {t.confirmations || 0} of {confirmationsNeeded(pa, chain)}{" "}
                        confirmations
                      </>
                    )}
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

function confirmationsNeeded(pa, chain) {
  // Sepolia L1 reorgs deeper than the L2s, hence the split. Mirrors
  // server/src/config/derivation.js — shown so the wait is explained rather
  // than just being a spinner.
  if (pa.chainId === 11155111) return 12;
  return chain && chain.testnet === false ? 12 : 5;
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
