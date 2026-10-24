import { useState } from "react";
import { ShieldCheck, X } from "lucide-react";
import { Button, Field, Input, Segmented, PageHeader } from "../../components/ui";
import { Modal } from "../../components/ui";
import {
  importFromMnemonic,
  importFromPrivateKey,
  importFromKeystore,
  encryptAndStore,
} from "./keystore";
import { saveAddress } from "./walletApi";
import { assessWalletPassword } from "./passwordStrength";
import { useAuth } from "../../context/AuthContext";

export default function ImportWalletModal({ onClose, onDone }) {
  const { user } = useAuth();
  const [mode, setMode] = useState("phrase");
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
    if (mode !== "keystore") {
      const verdict = assessWalletPassword(password, { email: user?.email, name: user?.name });
      if (!verdict.ok) return setError(verdict.reason);
      if (password !== confirm) return setError("Passwords do not match.");
    }

    setBusy(true);
    try {
      let wallet;
      let address;
      if (mode === "keystore") {
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

  function onFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setSecret(String(reader.result || ""));
    reader.onerror = () => setError("Could not read that file.");
    reader.readAsText(file);
  }

  return (
    <Modal label="Import wallet" view="import" crumb="Import a wallet" onClose={onClose}>
      <PageHeader
        title="Import a wallet"
        action={
          <Button variant="ghost" icon title="Close" onClick={onClose}>
            <X size={15} />
          </Button>
        }
      />

      <div className="wallet-guarantee">
        <ShieldCheck size={16} />
        <span>Your key is encrypted in your browser. Only the encrypted keystore is stored here.</span>
      </div>

      <form className="card stack" onSubmit={submit}>
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { id: "phrase", label: "Recovery phrase" },
            { id: "key", label: "Private key" },
            { id: "keystore", label: "Keystore file" },
          ]}
        />

        {mode === "key" && (
          <p className="inline-warn">
            A private key is one account and carries no seed, so a wallet
            imported this way <strong>cannot issue invoice payment addresses and cannot hold
            Bitcoin</strong>. Both are derived from the recovery phrase. If you have the phrase,
            import that instead and everything works.
          </p>
        )}

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
