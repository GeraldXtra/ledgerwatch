import { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import { Link } from "react-router-dom";
import {
  ArrowDownToLine,
  Ban,
  Check,
  ExternalLink,
  Fuel,
  KeyRound,
  ShieldCheck,
  TriangleAlert,
  X,
} from "lucide-react";
import { Button, Field, Input, Modal, SkeletonLines } from "../../components/ui";
import { unlockWallet } from "../wallet/keystore";
import { canDerive } from "../wallet/derivation";
import { executeSweepBatch, friendlySweepError, planSweep } from "./sweep";
import { ngn, shortHash, usdc } from "./format";

/**
 * Review and sign a sweep of one or many payment addresses.
 *
 * Mirrors SendForm's hard human-in-the-loop shape: full summary first, password
 * second, signing only after both. Nothing here is automatic, and the agent
 * never reaches this code — sweeping spends real funds.
 */
export default function SweepModal({ addresses, chains, mainAddress, destination, onClose, onDone }) {
  const [plans, setPlans] = useState(null);
  const [planError, setPlanError] = useState("");
  const [password, setPassword] = useState("");
  const [phase, setPhase] = useState("review"); // review | running | finished
  const [rows, setRows] = useState({});
  const [error, setError] = useState("");
  const [cannotDerive, setCannotDerive] = useState(false);

  const dest = destination || mainAddress;

  // Plan every selected address up front, so the review screen shows real
  // figures and real gas requirements rather than estimates made after the fact.
  useEffect(() => {
    let active = true;
    Promise.all(
      addresses.map((pa) =>
        planSweep({
          paymentAddress: pa,
          chain: chains.find((c) => c.chainId === pa.chainId) || null,
          destination: dest,
          mainAddress,
        }).catch((err) => ({ paymentAddressId: pa._id, address: pa.address, planFailed: friendlySweepError(err) }))
      )
    )
      .then((list) => {
        if (active) setPlans(list);
      })
      .catch((err) => {
        if (active) setPlanError(friendlySweepError(err));
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sweepable = useMemo(
    () => (plans || []).filter((p) => !p.planFailed && !p.empty),
    [plans]
  );

  const totals = useMemo(() => {
    const amount = sweepable.reduce((s, p) => s + p.amount, 0);
    const amountNgn = sweepable.reduce((s, p) => s + p.amountNgn, 0);
    const feeWei = sweepable.reduce((s, p) => s + (p.needsGasFunding ? p.fundingWei : 0n), 0n);
    const needFunding = sweepable.filter((p) => p.needsGasFunding).length;
    return { amount, amountNgn, feeWei, needFunding };
  }, [sweepable]);

  async function run(e) {
    e.preventDefault();
    setError("");
    if (!password) return setError("Enter your wallet password to sign.");
    if (!ethers.isAddress(dest)) return setError("The destination address is not valid.");

    setPhase("running");
    try {
      // Unlock ONCE for the whole batch. scrypt takes seconds, so unlocking per
      // address would make a batch of five unusable.
      const master = await unlockWallet(password, () => {});
      if (!canDerive(master)) {
        setCannotDerive(true);
        setPhase("review");
        return;
      }

      const results = await executeSweepBatch({
        master,
        plans: sweepable,
        onRow: (id, state) => setRows((prev) => ({ ...prev, [id]: state })),
      });

      setPassword("");
      setPhase("finished");
      onDone(results);
    } catch (err) {
      setError(friendlySweepError(err));
      setPhase("review");
    }
  }

  const chainOf = (p) => chains.find((c) => c.chainId === p.chainId) || null;
  const explorerTx = (p, hash) => {
    const c = chainOf(p);
    return c && c.explorer ? `${c.explorer}/tx/${hash}` : null;
  };

  if (cannotDerive) {
    return (
      <Modal label="Sweep funds" onClose={onClose}>
        <Head title="Sweep funds" onClose={onClose} />
        <div className="crypto-blocked">
          <span className="icon-tile neutral">
            <KeyRound size={16} />
          </span>
          <div>
            <div className="card-title">This wallet cannot sign for these addresses</div>
            <p className="muted small" style={{ margin: "4px 0 0" }}>
              It was imported from a private key on its own, so it has no recovery phrase and
              cannot derive the keys these addresses were created from. Re-import it using the
              recovery phrase and sweeping becomes available.
            </p>
          </div>
        </div>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Link to="/app/wallet" className="btn btn-primary" onClick={onClose}>
            Go to Wallet <ExternalLink size={14} />
          </Link>
        </div>
      </Modal>
    );
  }

  return (
    <Modal label="Sweep funds" onClose={phase === "running" ? () => {} : onClose} size="lg">
      <Head
        title={addresses.length === 1 ? "Sweep to your wallet" : `Sweep ${addresses.length} addresses`}
        onClose={onClose}
        disabled={phase === "running"}
      />

      <span className="testnet-badge">Testnet only</span>

      {planError ? (
        <p className="error-text" style={{ margin: 0 }}>
          {planError}
        </p>
      ) : !plans ? (
        <SkeletonLines count={4} />
      ) : (
        <>
          <p className="muted small" style={{ margin: 0 }}>
            This moves the stablecoin sitting at each invoice address into your main wallet. You
            sign every transfer yourself with your wallet password.
          </p>

          <ul className="tx-list sweep-list">
            {plans.map((p) => {
              const row = rows[p.paymentAddressId];
              return (
                <li key={p.paymentAddressId} className="row space-between crypto-tx-row">
                  <div className="row">
                    <span
                      className={`icon-tile ${
                        row?.state === "done"
                          ? "pos"
                          : row?.state === "failed" || p.planFailed
                          ? "neg"
                          : "neutral"
                      }`}
                    >
                      {row?.state === "done" ? (
                        <Check size={15} />
                      ) : row?.state === "failed" || p.planFailed ? (
                        <Ban size={15} />
                      ) : (
                        <ArrowDownToLine size={15} />
                      )}
                    </span>
                    <div>
                      <div className="num mono-strong">
                        {p.planFailed ? "—" : usdc(p.amount)}
                      </div>
                      <div className="muted caption">
                        {p.chainName} · <code>{shortHash(p.address)}</code>
                        {p.needsGasFunding && !row && (
                          <>
                            {" · "}
                            <Fuel size={11} style={{ verticalAlign: "-1px" }} /> needs gas first
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="sweep-row-state">
                    {p.planFailed ? (
                      <span className="error-text small">{p.planFailed}</span>
                    ) : p.empty ? (
                      <span className="muted caption">Already empty</span>
                    ) : row?.state === "working" ? (
                      <span className="muted caption">{row.step}…</span>
                    ) : row?.state === "failed" ? (
                      <span className="error-text small">{row.error}</span>
                    ) : row?.state === "done" && explorerTx(p, row.txHash) ? (
                      <a
                        className="tx-hash-link"
                        href={explorerTx(p, row.txHash)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {shortHash(row.txHash)} <ExternalLink size={12} />
                      </a>
                    ) : (
                      <span className="muted caption">{ngn(p.amountNgn)}</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          {sweepable.length > 0 && phase !== "finished" && (
            <dl className="trade-quote">
              <div>
                <dt>Total to move</dt>
                <dd className="num">{usdc(totals.amount)}</dd>
              </div>
              <div>
                <dt>Naira value</dt>
                <dd className="num">
                  {ngn(totals.amountNgn)}
                  <span className="quote-sub">at each invoice's snapshot rate</span>
                </dd>
              </div>
              <div>
                <dt>Destination</dt>
                <dd className="num sweep-dest">{dest}</dd>
              </div>
              {totals.needFunding > 0 && (
                <div>
                  <dt>Gas to send first</dt>
                  <dd className="num">
                    ≈ {Number(ethers.formatEther(totals.feeWei)).toFixed(6)}{" "}
                    {sweepable[0].nativeSymbol}
                    <span className="quote-sub">
                      {totals.needFunding === 1
                        ? "1 address holds no native token"
                        : `${totals.needFunding} addresses hold no native token`}
                    </span>
                  </dd>
                </div>
              )}
            </dl>
          )}

          {totals.needFunding > 0 && phase !== "finished" && (
            <div className="against-note">
              <Fuel size={15} />
              <span>
                An address holding only {sweepable[0].tokenSymbol} cannot pay for its own transfer,
                so your main wallet sends it a little {sweepable[0].nativeSymbol} first. That is a
                separate transaction you are approving here too, and it has to confirm before the
                sweep can be signed, which takes a few seconds per address. A small amount of{" "}
                {sweepable[0].nativeSymbol} is left behind as change.
              </span>
            </div>
          )}

          {sweepable.some((p) => p.gasSource !== "estimated") && phase !== "finished" && (
            <p className="settings-note">
              <TriangleAlert size={15} />
              The gas figure for at least one address is {sweepable.find((p) => p.gasSource !== "estimated").gasSource}.
            </p>
          )}

          {dest !== mainAddress && phase !== "finished" && (
            <p className="settings-note danger">
              <TriangleAlert size={15} />
              This is going to a destination you set in Settings, not the wallet on this device.
              Check the address above carefully.
            </p>
          )}

          {phase === "finished" ? (
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <Button variant="primary" onClick={onClose}>
                Done
              </Button>
            </div>
          ) : (
            <form className="stack" onSubmit={run}>
              <Field label="Wallet password">
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  disabled={phase === "running" || sweepable.length === 0}
                />
              </Field>

              <p className="settings-note">
                <ShieldCheck size={15} />
                Entered once for the whole batch, used in this browser, then discarded. Each
                transfer is signed here on your device.
              </p>

              {error && (
                <div className="against-note">
                  <TriangleAlert size={15} />
                  <span>{error}</span>
                </div>
              )}

              <div className="row" style={{ justifyContent: "flex-end" }}>
                <Button variant="ghost" onClick={onClose} disabled={phase === "running"}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  type="submit"
                  disabled={phase === "running" || sweepable.length === 0}
                >
                  {phase === "running"
                    ? "Signing…"
                    : sweepable.length === 0
                    ? "Nothing to sweep"
                    : sweepable.length === 1
                    ? "Sign and sweep"
                    : `Sign and sweep ${sweepable.length}`}
                </Button>
              </div>
            </form>
          )}
        </>
      )}
    </Modal>
  );
}

function Head({ title, onClose, disabled }) {
  return (
    <div className="row space-between">
      <h3 className="section-title row">
        <ArrowDownToLine size={17} /> {title}
      </h3>
      <Button variant="ghost" icon title="Close" onClick={onClose} disabled={disabled}>
        <X size={15} />
      </Button>
    </div>
  );
}
