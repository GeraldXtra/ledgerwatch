import { useMemo, useState } from "react";
import { AlertTriangle, Eye, EyeOff, ShieldCheck, X } from "lucide-react";
import { Button, Field, Input, Modal, PageHeader } from "../../components/ui";
import { createWallet, encryptAndStore } from "./keystore";
import { saveAddress } from "./walletApi";
import { assessWalletPassword, MIN_WALLET_PASSWORD } from "./passwordStrength";
import { useAuth } from "../../context/AuthContext";

export default function CreateWalletModal({ onClose, onDone }) {
  const { user } = useAuth();
  const [step, setStep] = useState("generate");
  const generated = useMemo(() => createWallet(), []);
  const [written, setWritten] = useState(false);
  const [showPk, setShowPk] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");

  const strength = useMemo(
    () => assessWalletPassword(password, { email: user?.email, name: user?.name }),
    [password, user]
  );

  const words = (generated.mnemonic || "").split(" ");

  async function finish(e) {
    e.preventDefault();
    setError("");
    const verdict = assessWalletPassword(password, { email: user?.email, name: user?.name });
    if (!verdict.ok) return setError(verdict.reason);
    if (password !== confirm) return setError("Passwords do not match.");
    setBusy(true);
    try {
      const address = await encryptAndStore(generated.wallet, password, (p) =>
        setProgress(Math.round(p * 100))
      );
      await saveAddress(address);
      onDone(address);
    } catch (err) {
      setError(err?.response?.data?.error || err.message || "Failed to create wallet");
      setBusy(false);
    }
  }

  return (
    <Modal label="Create wallet" view="create" crumb="Create a wallet" onClose={onClose}>
      <PageHeader
        title="Create a wallet"
        action={
          <Button variant="ghost" icon title="Close" onClick={onClose}>
            <X size={15} />
          </Button>
        }
      />

      {step === "generate" && (
        <div className="card stack">
          <div className="wallet-guarantee">
            <ShieldCheck size={16} />
            <span>
              Your key is generated in your browser and encrypted with your password.
              Only the encrypted keystore is stored on this device. It never reaches our servers.
            </span>
          </div>
          <p className="muted small">
            You are about to create a brand-new wallet. On the next screen you will see a
            twelve word recovery phrase. Write it down and keep it private, because it is the only way
            to restore this wallet.
          </p>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <Button variant="primary" onClick={() => setStep("backup")}>
              Show recovery phrase
            </Button>
          </div>
        </div>
      )}

      {step === "backup" && (
        <div className="card stack">
          <div className="wallet-warning">
            <AlertTriangle size={16} />
            <span>Anyone with this phrase can control the wallet. Never share it.</span>
          </div>
          <ol className="mnemonic-grid">
            {words.map((w, i) => (
              <li key={i}>
                <span className="mnemonic-num">{i + 1}</span>
                {w}
              </li>
            ))}
          </ol>

          <div className="wallet-pk">
            <button
              type="button"
              className="linklike"
              onClick={() => setShowPk((s) => !s)}
            >
              {showPk ? <EyeOff size={13} /> : <Eye size={13} />}
              {showPk ? "Hide private key" : "Show private key"}
            </button>
            {showPk && <code className="pk-value">{generated.privateKey}</code>}
          </div>

          <label className="toggle-row">
            <input type="checkbox" checked={written} onChange={(e) => setWritten(e.target.checked)} />
            <span>
              <span className="toggle-title">I have written down my recovery phrase</span>
              <span className="muted small">You will not be shown this phrase again.</span>
            </span>
          </label>

          <div className="row" style={{ justifyContent: "flex-end" }}>
            <Button variant="ghost" onClick={() => setStep("generate")}>
              Back
            </Button>
            <Button variant="primary" disabled={!written} onClick={() => setStep("password")}>
              Continue
            </Button>
          </div>
        </div>
      )}

      {step === "password" && (
        <form className="card stack" onSubmit={finish}>
          <p className="muted small">
            Set a password to encrypt the wallet on this device. You will enter it to send.
          </p>
          <Field label="Password">
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              required
            />
            <div className="caption muted" style={{ marginTop: 6 }}>
              {password
                ? strength.ok
                  ? `${strength.label}. This password is never sent anywhere and cannot be reset.`
                  : strength.reason
                : `At least ${MIN_WALLET_PASSWORD} characters. Three or four unrelated words work well — ` +
                  "this one encrypts your keys on this device and cannot be reset."}
            </div>
          </Field>
          <Field label="Confirm password">
            <Input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
          </Field>
          {busy && progress > 0 && (
            <div className="encrypt-progress">
              <div className="encrypt-bar" style={{ width: `${progress}%` }} />
              <span className="muted small">Encrypting… {progress}%</span>
            </div>
          )}
          {error && <p className="error-text">{error}</p>}
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <Button variant="ghost" onClick={() => setStep("backup")} disabled={busy}>
              Back
            </Button>
            <Button variant="primary" type="submit" disabled={busy}>
              {busy ? "Encrypting…" : "Create wallet"}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
