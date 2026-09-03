import { useMemo, useState } from "react";
import { AlertTriangle, Eye, EyeOff, ShieldCheck, X } from "lucide-react";
import { Button, Field, Input, Modal } from "../../components/ui";
import { createWallet, encryptAndStore } from "./keystore";
import { saveAddress } from "./walletApi";

/**
 * Create a new wallet: generate → show the recovery phrase ONCE (with an explicit
 * "I've written it down" confirmation) → encrypt with a password and store only the
 * ciphertext. The plaintext key/phrase never leave this component's memory.
 */
export default function CreateWalletModal({ onClose, onDone }) {
  const [step, setStep] = useState("generate"); // generate → backup → password
  const generated = useMemo(() => createWallet(), []); // in-memory only
  const [written, setWritten] = useState(false);
  const [showPk, setShowPk] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");

  const words = (generated.mnemonic || "").split(" ");

  async function finish(e) {
    e.preventDefault();
    setError("");
    if (password.length < 8) return setError("Use at least 8 characters.");
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
    <Modal label="Create wallet" onClose={onClose}>
      <div className="row space-between">
        <h3 className="section-title">Create a wallet</h3>
        <Button variant="ghost" icon title="Close" onClick={onClose}>
          <X size={15} />
        </Button>
      </div>

      {step === "generate" && (
        <div className="stack">
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
        <div className="stack">
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
        <form className="stack" onSubmit={finish}>
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
