import { useState } from "react";
import { ShieldCheck, X } from "lucide-react";
import { Button, Field, Input, Segmented } from "../../components/ui";
import { Modal } from "../../components/ui";
import {
  importFromMnemonic,
  importFromPrivateKey,
  importFromKeystore,
  encryptAndStore,
} from "./keystore";
import { saveAddress } from "./walletApi";

/**
 * Import an existing wallet from a recovery phrase or a private key, then encrypt it
 * with a password and store only the ciphertext (same guarantee as create).
 */
export default function ImportWalletModal({ onClose, onDone }) {
  const [mode, setMode] = useState("phrase"); // phrase | key | keystore
  const [secret, setSecret] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (!secret.trim()) {
      return setError(
        mode === "keystore"
          ? "Upload or paste your keystore JSON file."
          : "Enter your recovery phrase or private key."
      );
    }
    if (!password) return setError("Enter the password.");
    /**
     * A keystore already HAS a password — the one it was encrypted with. Asking
     * the user to invent a new one and confirm it would be nonsense, and getting
     * it wrong would produce a file they cannot open. So the confirm step, and
     * the minimum length, apply only when a NEW encryption password is being set.
     */
    if (mode !== "keystore") {
      if (password.length < 8) return setError("Use at least 8 characters.");
      if (password !== confirm) return setError("Passwords do not match.");
    }

    setBusy(true);
    try {
      let wallet;
      let address;
      if (mode === "keystore") {
        // Decrypting here also PROVES the password is right before anything is
        // stored — an imported keystore that cannot be opened is worse than a
        // failed import, because it looks like a working wallet.
        ({ wallet, address } = await importFromKeystore(secret, password, (p) =>
          setProgress(Math.round(p * 100))
        ));
      } else {
        ({ wallet, address } =
          mode === "phrase" ? importFromMnemonic(secret) : importFromPrivateKey(secret));
      }
      await encryptAndStore(wallet, password, (p) => setProgress(Math.round(p * 100)));
      await saveAddress(address);
      onDone(address);
    } catch (err) {
      const msg = (err && (err.shortMessage || err.message)) || "";
      setError(
        err?.response?.data?.error ||
          (mode === "keystore"
            ? /password|decrypt|invalid/i.test(msg)
              ? "That password does not open this keystore file."
              : msg || "That is not a valid keystore file."
            : mode === "phrase"
              ? "Invalid recovery phrase."
              : "Invalid private key.")
      );
      setBusy(false);
    }
  }

  /** Read an uploaded .json keystore into the same field a paste would fill. */
  function onFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setSecret(String(reader.result || ""));
    reader.onerror = () => setError("Could not read that file.");
    reader.readAsText(file);
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
            { id: "keystore", label: "Keystore file" },
          ]}
        />

        {mode === "keystore" && (
          <div className="stack-sm">
            <p className="muted small" style={{ margin: 0 }}>
              The encrypted JSON you downloaded from Settings → Wallet backup. It opens with the
              password it was created with. Importing it keeps the recovery phrase, so this wallet
              can still derive invoice payment addresses afterwards.
            </p>
            <input type="file" accept="application/json,.json" onChange={onFile} className="input" />
          </div>
        )}

        <Field
          label={
            mode === "phrase"
              ? "12 or 24-word recovery phrase"
              : mode === "key"
                ? "Private key (0x…)"
                : "Keystore JSON"
          }
        >
          <textarea
            className="input"
            rows={mode === "keystore" ? 5 : 3}
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder={
              mode === "phrase"
                ? "word1 word2 word3 …"
                : mode === "key"
                  ? "0x…"
                  : '{"address":"…","crypto":{…}}'
            }
            autoFocus
            style={{ resize: "vertical", fontFamily: "inherit" }}
          />
        </Field>
        {/* A keystore brings its own password, so there is nothing to confirm —
            asking would invite the user to "set" a password the file does not
            have and then wonder why it will not open. */}
        <div className={mode === "keystore" ? "" : "grid2"}>
          <Field label={mode === "keystore" ? "Keystore password" : "Password"}>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>
          {mode !== "keystore" && (
            <Field label="Confirm password">
              <Input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
            </Field>
          )}
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
