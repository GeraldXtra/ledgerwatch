import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, Eye, ShieldAlert, TriangleAlert, X } from "lucide-react";
import { Button, Field, Input, Modal, PageHeader } from "../../components/ui";
import { revealSecrets, markBackedUp } from "./keystore";
import { verifySecurityAnswers, getSecurityQuestions } from "./walletApi";

const AUTO_HIDE_MS = 60000;

export default function RevealSecretModal({ open, mode = "phrase", onClose }) {
  const [step, setStep] = useState("warn");
  const [password, setPassword] = useState("");
  const [answers, setAnswers] = useState({});
  const [questions, setQuestions] = useState(null);
  const [questionsError, setQuestionsError] = useState("");
  const [skipQuestions, setSkipQuestions] = useState(false);
  const [retryQuestions, setRetryQuestions] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);

  const secretRef = useRef(null);
  const [visible, setVisible] = useState(null);
  const [hasMnemonic, setHasMnemonic] = useState(true);

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
    setSkipQuestions(false);
    onClose();
  }, [onClose, wipe]);

  useEffect(() => () => wipe(), [wipe]);

  useEffect(() => {
    if (!open) return;
    setQuestionsError("");
    getSecurityQuestions()
      .then((d) => {
        setQuestions(d.enabled ? d.questions : null);
        setQuestionsError("");
      })
      .catch((err) => {
        setQuestions(null);
        setQuestionsError(
          err?.response?.data?.error ||
            err.message ||
            "the server did not answer"
        );
      });
  }, [open, retryQuestions]);

  useEffect(() => {
    if (!visible) return undefined;
    setSecondsLeft(Math.round(AUTO_HIDE_MS / 1000));
    const tick = setInterval(() => setSecondsLeft((s) => (s > 0 ? s - 1 : 0)), 1000);
    const hide = setTimeout(() => {
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
    if (questionsError && !skipQuestions) {
      return setError(
        "Whether this account asks extra questions could not be checked. Try again, or say explicitly that you want to continue without that check."
      );
    }

    setBusy(true);
    try {
      if (questions && questions.length) {
        const ok = await verifySecurityAnswers(
          questions.map((q, i) => ({ id: q.id, answer: answers[i] || "" }))
        );
        if (!ok.verified) {
          setBusy(false);
          return setError(ok.error || "Those answers do not match.");
        }
      }

      const secrets = await revealSecrets(password);

      if (mode === "phrase" && !secrets.mnemonic) {
        setHasMnemonic(false);
        secretRef.current = secrets.privateKey;
      } else {
        setHasMnemonic(true);
        secretRef.current = mode === "phrase" ? secrets.mnemonic : secrets.privateKey;
      }
      setStep("shown");
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
    <Modal label={title} view="reveal" crumb={title} onClose={closeAll}>
      <PageHeader
        title={title}
        action={
          <Button variant="ghost" icon title="Close" onClick={closeAll}>
            <X size={15} />
          </Button>
        }
      />

      {step === "warn" && (
        <div className="card stack">
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
                  will. Not support, not a developer, not an airdrop.
                </li>
                <li>Never type it into another website, form or chat.</li>
                <li>Write it on paper. A photo or a note app is readable by other software.</li>
                <li>There is no reset and no undo. Nobody can restore it for you.</li>
              </ul>
            </div>
          </div>

          {isPhrase ? (
            <p className="muted small">
              Your recovery phrase restores the <strong>entire wallet</strong>, meaning this address and
              every invoice payment address derived from it.
            </p>
          ) : (
            <p className="muted small">
              A private key exposes <strong>one account only</strong>. It does not restore the rest
              of the wallet or its derived invoice addresses. Only the recovery phrase does that.
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
        <form className="card stack" onSubmit={authenticate}>
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

          {questionsError && (
            <div className="against-note">
              <TriangleAlert size={15} />
              <span>
                Whether this account asks extra questions could not be checked:{" "}
                {questionsError}. If you set questions up, they are not being asked right now.
                <span className="row" style={{ marginTop: 8 }}>
                  <Button
                    size="sm"
                    onClick={() => {
                      setSkipQuestions(false);
                      setRetryQuestions((n) => n + 1);
                    }}
                    disabled={busy}
                  >
                    Try the check again
                  </Button>
                  <label className="toggle-inline">
                    <input
                      type="checkbox"
                      checked={skipQuestions}
                      onChange={(e) => setSkipQuestions(e.target.checked)}
                    />
                    <span className="muted small">Continue without it</span>
                  </label>
                </span>
              </span>
            </div>
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
              This takes a few seconds, because the encryption is deliberately slow to resist guessing.
            </p>
          )}
        </form>
      )}

      {step === "shown" && (
        <div className="card stack">
          {mode === "phrase" && !hasMnemonic && (
            <div className="reveal-warning warn">
              <TriangleAlert size={18} />
              <div>
                <p className="reveal-warn-lead">This wallet has no recovery phrase</p>
                <p className="muted small" style={{ margin: 0 }}>
                  It was imported from a private key, and a private key contains no seed to
                  rebuild a phrase from, so there is nothing to show. Your private key is below,
                  it is the only backup this wallet can have.
                </p>
              </div>
            </div>
          )}

          {!visible ? (
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
                Numbered because the order matters. The same words in a different order restore a
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
