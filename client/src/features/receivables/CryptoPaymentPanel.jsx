import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import { ArrowDownToLine, Ban, Check, Coins, Copy, ExternalLink, Hourglass, ShieldCheck, TriangleAlert } from "lucide-react";
import { Button, Card, Input, SkeletonLines } from "../../components/ui";
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

export default function CryptoPaymentPanel({ debt, refreshKey = 0 }) {
  const { user } = useAuth();
  const [addresses, setAddresses] = useState(null);
  const [chains, setChains] = useState([]);
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

  const needsLiveUpdates = (addresses || []).some((pa) => {
    if (pa.status !== "active" && pa.status !== "expired") return false;
    const observed = pa.observed || [];
    const confirming = observed.some((o) => o.status === "detected");
    const nothingYet = observed.length === 0;
    return confirming || nothingYet;
  });

  useEffect(() => {
    if (!needsLiveUpdates) return undefined;

    const id = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      load();
    }, 12000);
    return () => clearInterval(id);
  }, [needsLiveUpdates, load]);

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
    <Card title="Crypto payment">
      <div className="stack-sm">
      {addresses.map((pa) => (
        <AddressCard
          key={pa._id}
          pa={pa}
          chain={chains.find((c) => c.chainId === pa.chainId) || null}
          onChanged={load}
          sweepDestination={user?.crypto?.sweepDestination || null}
          confirmationsNeeded={confirmationsFor(pa.chainId, user)}
          currentRate={currentRate}
        />
      ))}
      </div>
    </Card>
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
      setRevokeError(
        err?.response?.data?.error ||
          "The address could not be revoked, so it is still active and still being watched. Try again."
      );
      await onChanged().catch(() => {
      });
    } finally {
      setRevoking(false);
    }
  }

  const observed = pa.observed || [];
  const confirmedTxs = observed.filter((t) => t.status === "confirmed");
  const detectedTxs = observed.filter((t) => t.status === "detected");
  const orphanedTxs = observed.filter((t) => t.status === "orphaned");

  const received = Number(pa.receivedUsdc) || 0;
  const expected = Number(pa.expectedUsdc) || 0;
  const pending = detectedTxs.reduce((sum, t) => sum + unitsToNumber(t.value, pa.tokenDecimals), 0);

  const unsettled = confirmedTxs
    .filter((t) => !t.settledPaymentId)
    .reduce((sum, t) => sum + unitsToNumber(t.value, pa.tokenDecimals), 0);
  const stillNeeded = Math.max(0, Math.round((expected - unsettled) * 100) / 100);

  const unit = pa.tokenSymbol || "USDC";

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
                          ok: false,
                          message:
                            "This address does NOT match what your wallet derives at this index. " +
                            "Do not give it to anyone. Revoke it and issue a new one.",
                        }
                  );
                  setVerifying(false);
                  setVerifyPassword("");
                } catch (err) {
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
                  {pa.rateIsFallback ? "fallback rate, not live" : agoLabel(pa.rateTimestamp)}
                </span>
                {!currentRate || !(currentRate.ngnPerUsd > 0) ? (
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
                {inGrace && (
                  <span className="quote-sub">
                    still watching for late payments until {shortDate(graceUntil)}
                  </span>
                )}
              </dd>
            </div>
          </dl>

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
              <span className="num mono-strong">
                {usdcAmount(unsettled)} of {usdc(expected, pa.tokenSymbol)}
              </span>
            </div>
            <ProgressBar paid={unsettled} total={expected || 1} />
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
                        <>Detected · {t.confirmations || 0} confirmations so far</>
                      ))}
                    {t.status === "orphaned" && <>Vanished in a reorg · not counted</>}
                  </div>
                </div>
              </div>
              <div className="row">
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
