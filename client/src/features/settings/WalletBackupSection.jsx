import { useEffect, useState } from "react";
import { Download, FileKey, KeyRound, ShieldCheck, ShieldQuestion, TriangleAlert } from "lucide-react";
import { Button, Field, Input, Select } from "../../components/ui";
import { getKeystoreJson, getStoredAddress, hasWallet, isBackedUp } from "../wallet/keystore";
import { getSecurityQuestions, saveSecurityQuestions } from "../wallet/walletApi";
import RevealSecretModal from "../wallet/RevealSecretModal";

/**
 * WALLET BACKUP AND RECOVERY.
 *
 * Without this screen the wallet is a trap. The encrypted keystore lives in one
 * browser's localStorage; clear site data, switch machine or lose the laptop and
 * the funds are gone — not stolen, just unreachable, with the owner never having
 * been given the one thing that could have restored them.
 *
 * Everything here decrypts in the browser through the single `unlockWallet`
 * path. No secret material is sent anywhere.
 */
export default function WalletBackupSection() {
  const [reveal, setReveal] = useState(null); // "phrase" | "key" | null
  const [walletPresent] = useState(() => hasWallet());
  const [address] = useState(() => getStoredAddress());
  const [backedUp, setBackedUp] = useState(() => isBackedUp());
  const [downloadError, setDownloadError] = useState("");

  if (!walletPresent) {
    return (
      <div className="stack">
        <div>
          <h3 className="section-title row">
            <KeyRound size={17} /> Wallet backup
          </h3>
          <p className="muted small" style={{ margin: "4px 0 0" }}>
            No wallet on this device for this account yet. Create one on the Wallet page and its
            backup options appear here.
          </p>
        </div>
      </div>
    );
  }

  /**
   * Download the encrypted keystore file.
   *
   * TWO THINGS WERE WRONG HERE, BOTH SILENT, ON A BACKUP PATH.
   *
   * The object URL was revoked in the same tick as the click. Chrome tolerates
   * that; Firefox and Safari have historically not, and the download simply does
   * not happen — with no error handling at all, the button did nothing visible
   * and the owner walked away believing their backup was saved. That only
   * surfaces on the day they need it. The URL is now released on the next turn
   * of the event loop, once the browser has taken the blob, and the file stays a
   * blob in this tab's memory for that instant rather than anywhere addressable.
   *
   * And `if (!json) return` meant a missing keystore did nothing whatsoever. It
   * says so now.
   */
  function downloadKeystore() {
    setDownloadError("");
    const json = getKeystoreJson();
    if (!json) {
      setDownloadError(
        "There is no encrypted wallet in this browser for this account, so there is nothing to download."
      );
      return;
    }
    try {
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ledgerwatch-keystore-${(address || "wallet").slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (err) {
      setDownloadError(
        `The keystore file could not be produced: ${
          err?.message || "your browser refused the download"
        }. Your recovery phrase is the backup that matters most, so reveal and write that down.`
      );
    }
  }

  return (
    <div className="stack">
      <div>
        <h3 className="section-title row">
          <KeyRound size={17} /> Wallet backup
        </h3>
        <p className="muted small" style={{ margin: "4px 0 0" }}>
          Your wallet is encrypted and stored in this browser only. If you clear site data or
          change device without a backup, the funds cannot be recovered, by you or by us.
        </p>
      </div>

      {!backedUp && (
        <div className="reveal-warning warn">
          <TriangleAlert size={18} />
          <div>
            <p className="reveal-warn-lead">This wallet has never been backed up</p>
            <p className="muted small" style={{ margin: 0 }}>
              Reveal and write down your recovery phrase now. It takes a minute and it is the only
              thing that can restore this wallet.
            </p>
          </div>
        </div>
      )}

      <div className="backup-options">
        <button type="button" className="backup-option" onClick={() => setReveal("phrase")}>
          <span className="icon-tile"><KeyRound size={16} /></span>
          <span className="grow">
            <span className="backup-option-title">Reveal secret recovery phrase</span>
            <span className="muted small">
              Twelve words that restore the whole wallet, including every invoice payment address
              derived from it.
            </span>
          </span>
        </button>

        <button type="button" className="backup-option" onClick={() => setReveal("key")}>
          <span className="icon-tile"><FileKey size={16} /></span>
          <span className="grow">
            <span className="backup-option-title">Export private key</span>
            <span className="muted small">
              This one account only. It does not restore the rest of the wallet. Only the
              recovery phrase does that.
            </span>
          </span>
        </button>

        <button type="button" className="backup-option" onClick={downloadKeystore}>
          <span className="icon-tile"><Download size={16} /></span>
          <span className="grow">
            <span className="backup-option-title">Download encrypted keystore</span>
            <span className="muted small">
              An encrypted file. Useless to anyone without your wallet password, so unlike the
              phrase it is safe to keep in cloud storage or email to yourself.
            </span>
          </span>
        </button>
      </div>

      {downloadError && <p className="error-text">{downloadError}</p>}

      <p className="settings-note">
        <ShieldCheck size={15} />
        Revealing happens entirely in this browser. Your phrase and key are never sent to
        LedgerWatch, never written to a log, and never stored anywhere but your own device.
      </p>

      <SecurityQuestions />

      {reveal && (
        <RevealSecretModal
          open
          mode={reveal}
          onClose={() => {
            setReveal(null);
            setBackedUp(isBackedUp());
          }}
        />
      )}
    </div>
  );
}

/**
 * OPTIONAL extra verification. Deliberately framed as an ADDITION, never a
 * recovery route: this wallet is non-custodial, so a forgotten password cannot
 * be reset by anyone, and pretending otherwise would be the cruellest possible
 * bug to ship.
 */
function SecurityQuestions() {
  const [state, setState] = useState(null);
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState([
    { id: "", prompt: "", answer: "" },
    { id: "", prompt: "", answer: "" },
    { id: "", prompt: "", answer: "" },
  ]);
  const [custom, setCustom] = useState({ prompt: "", answer: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  /**
   * A FAILED LOAD IS NOT AN ANSWER ABOUT THE OWNER'S SECURITY (LW-029).
   *
   * This substituted `{ enabled: false }` on any error, so one network blip told
   * an owner who HAS configured extra verification, in a plain sentence, that
   * their wallet password alone unlocks a reveal. That is both untrue about
   * their own posture and — with the reveal dialog quietly skipping the same
   * check when its fetch fails — the visible half of a control that did not run.
   * The four states ARCHITECTURE §9.1 asks for are kept apart here: loading,
   * ready, error, and the genuine "off".
   */
  const [loadError, setLoadError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let live = true;
    getSecurityQuestions()
      .then((d) => {
        if (!live) return;
        setState(d);
        setLoadError("");
      })
      .catch((err) => {
        if (!live) return;
        setState(null);
        setLoadError(
          err?.response?.data?.error || err.message || "the server did not answer"
        );
      });
    return () => {
      live = false;
    };
  }, [reload]);

  if (loadError) {
    return (
      <div className="stack-sm security-questions">
        <div className="row">
          <span className="icon-tile"><ShieldQuestion size={16} /></span>
          <div>
            <div className="backup-option-title">Extra verification before revealing</div>
            <div className="muted small">
              Whether this is on could not be checked: {loadError}. This says nothing about your
              settings, which are unchanged.
            </div>
          </div>
        </div>
        <div>
          <Button size="sm" onClick={() => setReload((n) => n + 1)}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  if (!state) return null;
  const presets = state.presets || [];

  async function save(enabled) {
    setError("");
    setBusy(true);
    try {
      if (!enabled) {
        const d = await saveSecurityQuestions({ enabled: false, answers: [] });
        setState((s) => ({ ...s, ...d }));
        setEditing(false);
        return;
      }
      const answers = rows
        .filter((r) => r.id && r.answer.trim())
        .map((r) => ({
          id: r.id,
          prompt: (presets.find((p) => p.id === r.id) || {}).prompt || r.id,
          answer: r.answer,
        }));
      if (custom.prompt.trim() && custom.answer.trim()) {
        answers.push({ id: "custom", prompt: custom.prompt.trim(), answer: custom.answer });
      }
      if (answers.length < 3) {
        setBusy(false);
        return setError("Choose at least three questions and answer each of them.");
      }
      const d = await saveSecurityQuestions({ enabled: true, answers });
      setState((s) => ({ ...s, ...d, enabled: true }));
      setEditing(false);
      setRows(rows.map((r) => ({ ...r, answer: "" })));
      setCustom({ prompt: "", answer: "" });
    } catch (err) {
      setError(err?.response?.data?.error || "Could not save your verification settings.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack-sm security-questions">
      <div className="row space-between wrap">
        <div className="row">
          <span className="icon-tile"><ShieldQuestion size={16} /></span>
          <div>
            <div className="backup-option-title">Extra verification before revealing</div>
            <div className="muted small">
              {state.enabled
                ? `On. ${(state.questions || []).length} questions are asked alongside your password.`
                : "Off. Your wallet password alone unlocks a reveal."}
            </div>
          </div>
        </div>
        <Button variant={state.enabled ? "ghost" : "secondary"} onClick={() => setEditing((v) => !v)}>
          {editing ? "Cancel" : state.enabled ? "Change" : "Set up"}
        </Button>
      </div>

      <p className="muted caption" style={{ margin: 0 }}>
        This is an <strong>extra lock, not a spare key</strong>. It never replaces your wallet
        password and it cannot recover one you have forgotten. Nobody can, because the password
        never reaches our servers. Security questions are also a weak factor on their own, since
        answers are often discoverable, which is exactly why they sit alongside the password
        rather than instead of it.
      </p>

      {editing && (
        <div className="stack-sm">
          {rows.map((r, i) => (
            <div className="grid2" key={i}>
              <Field label={`Question ${i + 1}`}>
                <Select
                  value={r.id}
                  onChange={(e) =>
                    setRows((rs) => rs.map((x, j) => (j === i ? { ...x, id: e.target.value } : x)))
                  }
                >
                  <option value="">Choose a question…</option>
                  {presets
                    .filter((p) => p.id === r.id || !rows.some((x) => x.id === p.id))
                    .map((p) => (
                      <option key={p.id} value={p.id}>{p.prompt}</option>
                    ))}
                </Select>
              </Field>
              <Field label="Answer">
                <Input
                  value={r.answer}
                  autoComplete="off"
                  onChange={(e) =>
                    setRows((rs) => rs.map((x, j) => (j === i ? { ...x, answer: e.target.value } : x)))
                  }
                />
              </Field>
            </div>
          ))}

          <div className="grid2">
            <Field label="Your own question (optional)">
              <Input
                value={custom.prompt}
                onChange={(e) => setCustom((c) => ({ ...c, prompt: e.target.value }))}
                placeholder="Something only you would know"
              />
            </Field>
            <Field label="Answer">
              <Input
                value={custom.answer}
                autoComplete="off"
                onChange={(e) => setCustom((c) => ({ ...c, answer: e.target.value }))}
              />
            </Field>
          </div>

          <p className="muted caption" style={{ margin: 0 }}>
            Answers are hashed before they are stored, so nobody, including us, can read them
            back. Capitalisation and extra spaces are ignored when you answer.
          </p>

          {error && <p className="error-text">{error}</p>}

          <div className="row" style={{ justifyContent: "flex-end" }}>
            {state.enabled && (
              <Button variant="ghost" onClick={() => save(false)} disabled={busy}>
                Turn off
              </Button>
            )}
            <Button variant="primary" onClick={() => save(true)} disabled={busy}>
              {busy ? "Saving…" : "Save questions"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
