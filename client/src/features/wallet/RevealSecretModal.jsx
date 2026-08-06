import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, Eye, KeyRound, ShieldAlert, TriangleAlert, X } from "lucide-react";
import { Button, Field, Input, Modal } from "../../components/ui";
import { revealSecrets, markBackedUp } from "./keystore";
import { verifySecurityAnswers, getSecurityQuestions } from "./walletApi";

/**
 * REVEAL THE WALLET'S SECRET MATERIAL, FOR BACKUP.
 *
 * Without this the wallet is a trap: the encrypted keystore sits in one browser
 * and the owner has no way to get their phrase out, so clearing site data or
 * changing machine loses the funds permanently even though nothing was stolen.
 *
 * ---------------------------------------------------------------------------
 * THE RULES THIS COMPONENT FOLLOWS
 * ---------------------------------------------------------------------------
 * 1. Decryption happens HERE, in the browser, through `revealSecrets` — which
 *    calls the same `unlockWallet` the signing path uses. There is no second
 *    decryption path in this codebase and this does not add one.
 * 2. The phrase and key NEVER reach the server: not in a body, not in a query,
 *    not in a log, not in an error message.
 * 3. Secret text is NOT PUT IN THE DOM until the user explicitly asks to see it.
 *    A CSS blur is a visual effect, not a protection — the characters would
 *    still be in the page, readable by an extension or a screen reader, and
 *    present in a screenshot taken by a screen-sharing tool. So the value stays
 *    in a ref until revealed and is stripped from state on hide.
 * 4. It clears itself: 60 seconds after revealing, on close, and on unmount.
 */

const AUTO_HIDE_MS = 60000;

export default function RevealSecretModal({ open, mode = "phrase", onClose }) {
  // step: warn -> auth -> shown
  const [step, setStep] = useState("warn");
  const [password, setPassword] = useState("");
  const [answers, setAnswers] = useState({});
  const [questions, setQuestions] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);

  /**
   * The decrypted material lives in a ref, NOT in state, so it is never part of
   * a render until `visible` is deliberately set. `visible` holds the same value
   * only for as long as it is on screen.
   */
  const secretRef = useRef(null);
  const [visible, setVisible] = useState(null);
  const [hasMnemonic, setHasMnemonic] = useState(true);

  /** Wipe every copy. Called on hide, on close, on unmount and on the timer. */
  const wipe = useCallback(() => {
    secretRef.current = null;
    setVisible(null);
    setSecondsLeft(0);
  }, []);

  const closeAll = useCallback(() => {
    wipe();
    setStep("warn");
    setPassword("");
    setAnswers({});
    setError("");
    setCopied(false);
    onClose();
  }, [onClose, wipe]);

  // Clear on unmount — navigating away must not leave a phrase in memory.
  useEffect(() => () => wipe(), [wipe]);

  // Whether this account added the optional extra questions.
  useEffect(() => {
    if (!open) return;
    getSecurityQuestions()
      .then((d) => setQuestions(d.enabled ? d.questions : null))
      .catch(() => setQuestions(null)); // absent extra layer must not block backup
  }, [open]);

  /** Auto-hide countdown. */
  useEffect(() => {
    if (!visible) return undefined;
    setSecondsLeft(Math.round(AUTO_HIDE_MS / 1000));
    const tick = setInterval(() => setSecondsLeft((s) => (s > 0 ? s - 1 : 0)), 1000);
    const hide = setTimeout(() => {
      // Back to the concealed state, not closed: the user may still be writing.
      setVisible(null);
      setSecondsLeft(0);
    }, AUTO_HIDE_MS);
    return () => {
      clearInterval(tick);
      clearTimeout(hide);
    };
  }, [visible]);

  async function authenticate(e) {
    e.preventDefault();
    setError("");
    if (!password) return setError("Enter your wallet password.");

    setBusy(true);
    try {
      // The OPTIONAL extra layer, when the user turned it on. Checked server
      // side, where a rate limit is actually enforceable. The answers travel;
      // the secret never does.
      if (questions && questions.length) {
        const ok = await verifySecurityAnswers(
          questions.map((q, i) => ({ id: q.id, answer: answers[i] || "" }))
        );
        if (!ok.verified) {
          setBusy(false);
          return setError(ok.error || "Those answers do not match.");
        }
      }

      /**
       * scrypt runs here. It takes seconds ON PURPOSE — that cost is the real
       * brute-force protection on this screen, far more than any counter the UI
       * could keep, since anything client-side is bypassable with devtools.
       */
      const secrets = await revealSecrets(password);

      if (mode === "phrase" && !secrets.mnemonic) {
        // Not a failure to fix — arithmetic. A key carries no seed.
        setHasMnemonic(false);
        secretRef.current = secrets.privateKey;
      } else {
        setHasMnemonic(true);
        secretRef.current = mode === "phrase" ? secrets.mnemonic : secrets.privateKey;
      }
      setStep("shown");
      // Getting this far means they can recover the wallet, so stop nagging.
      markBackedUp();
    } catch (err) {
      const msg = (err && (err.shortMessage || err.message)) || "";
      setError(
        /password|decrypt|invalid/i.test(msg)
          ? "Incorrect password. Nothing was revealed."
          : msg || "Could not unlock the wallet."
      );
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!secretRef.current) return;
    try {
      await navigator.clipboard.writeText(secretRef.current);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Your browser blocked clipboard access. Copy it by hand from the screen.");
    }
  }

  if (!open) return null;

  const isPhrase = mode === "phrase" && hasMnemonic;
  const title = isPhrase ? "Secret recovery phrase" : "Private key";

  return (
    // `label` (not `title`) — Modal takes { onClose, label, size }, and it is
    // what names the dialog for assistive technology.
    <Modal label={title} onClose={closeAll}>
      <div className="row space-between">
        <h3 className="section-title row">
          <KeyRound size={17} /> {title}
        </h3>
        <Button variant="ghost" icon title="Close" onClick={closeAll}>
          <X size={15} />
        </Button>
      </div>

      {step === "warn" && (
        <div className="stack">
          <div className="reveal-warning">
            <ShieldAlert size={20} />
            <div>
              <p className="reveal-warn-lead">
                Anyone who has this can take everything in the wallet, immediately and
                irreversibly.
              </p>
              <ul className="reveal-warn-list">
                <li>
                  <strong>LedgerWatch will never ask you for it.</strong> Nobody legitimate ever
                  will — not support, not a developer, not an airdrop.
                </li>
                <li>Never type it into another website, form or chat.</li>
                <li>Write it on paper. A photo or a note app is readable by other software.</li>
                <li>There is no reset and no undo. Nobody can restore it for you.</li>
              </ul>
            </div>
          </div>

          {isPhrase ? (
            <p className="muted small">
              Your recovery phrase restores the <strong>entire wallet</strong> — this address and
              every invoice payment address derived from it.
            </p>
          ) : (
            <p className="muted small">
              A private key exposes <strong>one account only</strong>. It does not restore the rest
              of the wallet or its derived invoice addresses — the recovery phrase does that.
            </p>
          )}

          <div className="row" style={{ justifyContent: "flex-end" }}>
            <Button variant="ghost" onClick={closeAll}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => setStep("auth")}>
              I understand, continue
            </Button>
          </div>
        </div>
      )}

      {step === "auth" && (
        <form className="stack" onSubmit={authenticate}>
          <p className="muted small" style={{ margin: 0 }}>
            Unlocking happens entirely in this browser. Nothing secret is sent anywhere.
          </p>

          <Field label="Wallet password">
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              autoComplete="current-password"
            />
          </Field>

          {questions && questions.length > 0 && (
            <>
              <p className="muted caption" style={{ margin: 0 }}>
                You turned on extra verification for this account.
              </p>
              {questions.map((q, i) => (
                <Field key={q.id} label={q.prompt}>
                  <Input
                    value={answers[i] || ""}
                    onChange={(e) => setAnswers((a) => ({ ...a, [i]: e.target.value }))}
                    autoComplete="off"
                  />
                </Field>
              ))}
            </>
          )}

          {error && <p className="error-text">{error}</p>}

          <div className="row" style={{ justifyContent: "flex-end" }}>
            <Button variant="ghost" onClick={closeAll} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" loading={busy}>
              {busy ? "Unlocking…" : "Unlock and reveal"}
            </Button>
          </div>
          {busy && (
            <p className="muted caption" style={{ margin: 0 }}>
              This takes a few seconds — the encryption is deliberately slow to resist guessing.
            </p>
          )}
        </form>
      )}

      {step === "shown" && (
        <div className="stack">
          {mode === "phrase" && !hasMnemonic && (
            <div className="reveal-warning warn">
              <TriangleAlert size={18} />
              <div>
                <p className="reveal-warn-lead">This wallet has no recovery phrase</p>
                <p className="muted small" style={{ margin: 0 }}>
                  It was imported from a private key, and a private key contains no seed to
                  rebuild a phrase from — so there is nothing to show. Your private key is below;
                  it is the only backup this wallet can have.
                </p>
              </div>
            </div>
          )}

          {!visible ? (
            /* Concealed. The secret is NOT in the DOM at this point — only in a
               ref — so a screen share, an extension or a screenshot catches
               nothing. Revealing is a deliberate act. */
            <button type="button" className="reveal-cover" onClick={() => setVisible(secretRef.current)}>
              <Eye size={22} />
              <span className="reveal-cover-title">Tap to reveal</span>
              <span className="muted small">
                Make sure nobody can see your screen and that you are not sharing it.
              </span>
            </button>
          ) : isPhrase ? (
            <>
              <ol className="phrase-grid">
                {visible.split(/\s+/).map((word, i) => (
                  <li key={`${i}-${word}`} className="phrase-word">
                    <span className="phrase-num">{i + 1}</span>
                    {word}
                  </li>
                ))}
              </ol>
              <p className="muted caption" style={{ margin: 0 }}>
                Numbered because the order matters — the same words in a different order restore a
                different wallet.
              </p>
            </>
          ) : (
            <code className="reveal-key">{visible}</code>
          )}

          {visible && (
            <div className="row space-between wrap">
              <span className="muted caption">
                Hides automatically in {secondsLeft}s
              </span>
              <div className="row">
                <Button variant="ghost" onClick={() => setVisible(null)}>
                  <X size={14} /> Hide now
                </Button>
                <Button variant="secondary" onClick={copy}>
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
            </div>
          )}

          {visible && (
            <p className="muted caption" style={{ margin: 0 }}>
              Copying puts it on your system clipboard, where other applications can read it.
              Paste it where you need it and copy something else afterwards.
            </p>
          )}

          {error && <p className="error-text">{error}</p>}

          <div className="row" style={{ justifyContent: "flex-end" }}>
            <Button variant="primary" onClick={closeAll}>
              Done
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/** The key icon used by the Settings entry points. */
export { KeyRound as RevealIcon };
