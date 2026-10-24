import { useEffect, useState } from "react";
import { ethers } from "ethers";
import { ArrowDownToLine, ShieldCheck, TriangleAlert, X } from "lucide-react";
import { Button, Field, Input, Modal, PageHeader, SkeletonLines } from "../../components/ui";
import { unlockWallet } from "../wallet/keystore";
import { canDerive } from "../wallet/derivation";
import { executeProfitWithdraw, planProfitWithdraw } from "./profitWallet";

function reason(err) {
  return err?.response?.data?.error || err?.shortMessage || err?.message || "something went wrong";
}

export default function ProfitWithdrawModal({ chain, token, profitAddress, mainAddress, onClose, onDone }) {
  const [plan, setPlan] = useState(null);
  const [planError, setPlanError] = useState("");
  const [password, setPassword] = useState("");
  const [phase, setPhase] = useState("review");
  const [step, setStep] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(null);

  useEffect(() => {
    let active = true;
    planProfitWithdraw({ chainId: chain.chainId, token, profitAddress, mainAddress })
      .then((p) => active && setPlan(p))
      .catch((err) => active && setPlanError(`The profit wallet could not be read: ${reason(err)}.`));
    return () => {
      active = false;
    };
  }, [chain.chainId, token, profitAddress, mainAddress]);

  async function run(e) {
    e.preventDefault();
    setError("");
    if (!password) return setError("Enter your wallet password to sign.");
    setPhase("running");
    try {
      const master = await unlockWallet(password, () => {});
      if (!canDerive(master)) {
        setPhase("review");
        return setError("This wallet was imported from a private key, so it cannot sign for the profit wallet.");
      }
      const out = await executeProfitWithdraw({ master, plan, nativeSymbol: chain.nativeSymbol, onStep: setStep });
      setPassword("");
      setDone(out);
      setPhase("finished");
      onDone(out);
    } catch (err) {
      setPhase("review");
      setError(/invalid password/i.test(String(err && err.message)) ? "That wallet password is not right. Nothing was sent." : reason(err));
    }
  }

  return (
    <Modal label="Move profit back" view="profit-withdraw" onClose={phase === "running" ? () => {} : onClose}>
      <PageHeader
        title={`Move ${token.symbol} back to your trading wallet`}
        action={
          <Button variant="ghost" icon title="Close" onClick={onClose} disabled={phase === "running"}>
            <X size={15} />
          </Button>
        }
      />
      <section className="card stack">
        {planError ? (
          <p className="error-text" style={{ margin: 0 }}>{planError}</p>
        ) : !plan ? (
          <SkeletonLines count={3} />
        ) : plan.empty ? (
          <p className="muted" style={{ margin: 0 }}>
            Your profit wallet holds no {token.symbol} on {chain.name}.
          </p>
        ) : (
          <dl className="trade-quote">
            <div>
              <dt>Amount</dt>
              <dd className="num">
                {plan.amount} {token.symbol}
                <span className="quote-sub">everything the profit wallet holds on {chain.name}</span>
              </dd>
            </div>
            <div>
              <dt>To</dt>
              <dd className="num sweep-dest">{mainAddress}</dd>
            </div>
            <div>
              <dt>Network fee</dt>
              <dd className="num">
                ≈ {Number(ethers.formatEther(plan.feeWei)).toFixed(6)} {chain.nativeSymbol}
                {plan.needsGasFunding && (
                  <span className="quote-sub">
                    sent from your trading wallet first, as a separate transaction, because the profit wallet holds no {chain.nativeSymbol}
                  </span>
                )}
              </dd>
            </div>
          </dl>
        )}
        <p className="settings-note">
          <ShieldCheck size={15} />
          Both wallets come from your recovery phrase. Every transfer is signed here on your device.
        </p>
      </section>

      {phase === "finished" ? (
        <>
          <section className="card">
            <p style={{ margin: 0 }}>
              {done.amount} {token.symbol} is on its way to your trading wallet. You will be notified when it arrives.
            </p>
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
                disabled={phase === "running" || !plan || plan.empty}
              />
            </Field>
            {phase === "running" && step && <p className="muted small" style={{ margin: 0 }}>{step}…</p>}
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
            <Button variant="primary" type="submit" disabled={phase === "running" || !plan || plan.empty}>
              <ArrowDownToLine size={14} /> {phase === "running" ? "Signing…" : "Sign and move"}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
