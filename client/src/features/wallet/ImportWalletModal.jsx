import { useState } from "react";
import { ShieldCheck, X } from "lucide-react";
import { Button, Field, Input, Segmented } from "../../components/ui";
import { Modal } from "../../components/ui";
import { importFromMnemonic, importFromPrivateKey, encryptAndStore } from "./keystore";
import { saveAddress } from "./walletApi";

/**
 * Import an existing wallet from a recovery phrase or a private key, then encrypt it
 * with a password and store only the ciphertext (same guarantee as create).
 */
export default function ImportWalletModal({ onClose, onDone }) {
  const [mode, setMode] = useState("phrase"); // phrase | key
  const [secret, setSecret] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (!secret.trim()) return setError("Enter your recovery phrase or private key.");
    if (password.length < 8) return setError("Use at least 8 characters.");
    if (password !== confirm) return setError("Passwords do not match.");

    setBusy(true);
    try {
      const { wallet, address } =
        mode === "phrase" ? importFromMnemonic(secret) : importFromPrivateKey(secret);
      await encryptAndStore(wallet, password, (p) => setProgress(Math.round(p * 100)));
      await saveAddress(address);
      onDone(address);
    } catch (err) {
      setError(
        err?.response?.data?.error ||
          (mode === "phrase" ? "Invalid recovery phrase." : "Invalid private key.")
      );
      setBusy(false);
    }
  }

  return (
    <Modal label="Import wallet" onClose={onClose}>
      <div className="row space-between">
        <h3 className="section-title">Import a wallet</h3>
        <Button variant="ghost" icon title="Close" onClick={onClose}>
          <X size={15} />
        </Button>
      </div>

      <div className="wallet-guarantee">
        <ShieldCheck size={16} />
        <span>Your key is encrypted in your browser. Only the encrypted keystore is stored here.</span>
      </div>

      <form className="stack" onSubmit={submit}>
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { id: "phrase", label: "Recovery phrase" },
            { id: "key", label: "Private key" },
          ]}
        />
        <Field label={mode === "phrase" ? "12 or 24-word recovery phrase" : "Private key (0x…)"}>
          <textarea
            className="input"
            rows={3}
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder={mode === "phrase" ? "word1 word2 word3 …" : "0x…"}
            autoFocus
            style={{ resize: "vertical", fontFamily: "inherit" }}
          />
        </Field>
        <div className="grid2">
          <Field label="Password">
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
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
        </div>
        {busy && progress > 0 && (
          <div className="encrypt-progress">
            <div className="encrypt-bar" style={{ width: `${progress}%` }} />
            <span className="muted small">Encrypting… {progress}%</span>
          </div>
        )}
        {error && <p className="error-text">{error}</p>}
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={busy}>
            {busy ? "Encrypting…" : "Import wallet"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
