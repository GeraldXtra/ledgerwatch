import { useEffect, useState } from "react";
import { ethers } from "ethers";
import { ExternalLink, PiggyBank, ShieldCheck, TriangleAlert, X } from "lucide-react";
import { Button, Field, Input, Modal, PageHeader, SkeletonLines } from "../../components/ui";
import { unlockWallet } from "../wallet/keystore";
import { canDerive } from "../wallet/derivation";
import { executeProfitMove, planProfitMove } from "./profitWallet";

function money(n) {
  return `$${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function reason(err) {
  return err?.response?.data?.error || err?.shortMessage || err?.message || "something went wrong";
}

export default function ProfitMoveModal({ profit, chain, mainAddress, onClose, onDone }) {
  const [plan, setPlan] = useState(null);
  const [planError, setPlanError] = useState("");
  const [password, setPassword] = useState("");
  const [phase, setPhase] = useState("review");
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  useEffect(() => {
    let active = true;
    planProfitMove({ profit, from: mainAddress })
      .then((p) => active && setPlan(p))
      .catch((err) => active && setPlanError(`The move could not be prepared: ${reason(err)}.`));
    return () => {
      active = false;
    };
  }, [profit, mainAddress]);

  const blocked = plan && (!plan.enoughToken || !plan.enoughGas || plan.reverted);

  async function run(e) {
    e.preventDefault();
    setError("");
    if (!password) return setError("Enter your wallet password to sign.");
    setPhase("running");
    try {
      const master = await unlockWallet(password, () => {});
      if (!canDerive(master)) {
        setPhase("review");
        return setError(
          "This wallet was imported from a private key, so it has no recovery phrase and cannot hold a separate profit wallet. Re-import it using your recovery phrase to move profit."
        );
      }
      const out = await executeProfitMove({ master, profit, plan });
      setPassword("");
      setResult(out);
      setPhase("finished");
      onDone(out);
    } catch (err) {
      setPhase("review");
      setError(/invalid password/i.test(String(err && err.message)) ? "That wallet password is not right. Nothing was sent." : reason(err));
    }
  }

  const explorer = result && chain && chain.explorer ? `${chain.explorer}/tx/${result.hash}` : null;

  return (
    <Modal label="Move profit" view="profit" onClose={phase === "running" ? () => {} : onClose}>
      <PageHeader
        title="Move profit to your profit wallet"
        action={
          <Button variant="ghost" icon title="Close" onClick={onClose} disabled={phase === "running"}>
            <X size={15} />
          </Button>
        }
      />

      <section className="card stack">
        <div className="row">
          <span className="icon-tile pos">
            <PiggyBank size={16} />
          </span>
          <div>
            <div className="card-title">
              {money(profit.profitUsd)} profit on {profit.symbol}
            </div>
            <p className="muted small" style={{ margin: "4px 0 0" }}>{profit.message}</p>
          </div>
        </div>

        {planError ? (
          <p className="error-text" style={{ margin: 0 }}>{planError}</p>
        ) : !plan ? (
          <SkeletonLines count={3} />
        ) : (
          <dl className="trade-quote">
            <div>
              <dt>Amount to move</dt>
              <dd className="num">
                {plan.amount} {plan.symbol}
                <span className="quote-sub">exactly the profit, nothing more</span>
              </dd>
            </div>
            <div>
              <dt>From</dt>
              <dd className="num sweep-dest">{mainAddress}</dd>
            </div>
            <div>
              <dt>To</dt>
              <dd className="num">
                Your profit wallet
                <span className="quote-sub">
                  {result ? result.destination : "Account 2 of your recovery phrase, worked out on this device when you sign"}
                </span>
              </dd>
            </div>
            <div>
              <dt>Network fee</dt>
              <dd className="num">
                ≈ {Number(ethers.formatEther(plan.feeWei)).toFixed(6)} {chain ? chain.nativeSymbol : ""}
              </dd>
            </div>
          </dl>
        )}

        {plan && !plan.enoughToken && (
          <div className="against-note">
            <TriangleAlert size={15} />
            <span>
              Your trading wallet holds less than {plan.amount} {plan.symbol} now, so this profit cannot be
              moved as it stands. It stays recorded here.
            </span>
          </div>
        )}
        {plan && plan.enoughToken && !plan.enoughGas && (
          <div className="against-note">
            <TriangleAlert size={15} />
            <span>
              Your trading wallet does not hold enough {chain ? chain.nativeSymbol : "of the network's coin"} to pay
              the network fee for this transfer.
            </span>
          </div>
        )}
        {plan && plan.reverted && (
          <div className="against-note">
            <TriangleAlert size={15} />
            <span>The network says this transfer would fail: {plan.reverted}</span>
          </div>
        )}

        <p className="settings-note">
          <ShieldCheck size={15} />
          The profit wallet is the second account of your own recovery phrase. Only you can move what
          is in it, and any wallet you import the phrase into shows it as Account 2.
        </p>
      </section>

      {phase === "finished" ? (
        <>
          <section className="card stack">
            <p style={{ margin: 0 }}>
              {result.broadcast === "sent"
                ? "Sent. You will be notified when it confirms."
                : `Signed and recorded, but the network did not confirm it received it (${result.broadcastReason}). It is being watched; check the hash before trying again.`}
            </p>
            {explorer && (
              <a className="tx-hash-link" href={explorer} target="_blank" rel="noopener noreferrer">
                {result.hash.slice(0, 10)}…{result.hash.slice(-6)} <ExternalLink size={12} />
              </a>
            )}
          </section>
          <div className="pv-foot">
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </div>
        </>
      ) : (
        <form className="pv-form" onSubmit={run}>
          <section className="card stack">
            <Field label="Wallet password">
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                disabled={phase === "running" || !plan || blocked}
              />
            </Field>
            {error && (
              <div className="against-note">
                <TriangleAlert size={15} />
                <span>{error}</span>
              </div>
            )}
          </section>
          <div className="pv-foot">
            <Button variant="ghost" onClick={onClose} disabled={phase === "running"}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={phase === "running" || !plan || blocked}>
              {phase === "running" ? "Signing…" : "Sign and move profit"}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
