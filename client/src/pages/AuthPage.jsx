import { useState } from "react";
import { AlertCircle, ChevronDown, Wand2 } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Button, Field, Input } from "../components/ui";
import LogoMark from "../components/LogoMark";
import Turnstile, { turnstileEnabled } from "../components/Turnstile";

/**
 * THE GATE
 *
 * A ledger spread. The record on the left on ink, the form on the right on
 * paper. The old page put a tinted panel with three ticked benefits and a fake
 * dashboard screenshot beside the form, which is the standard split and says
 * nothing that the landing page has not already said better.
 *
 * The left panel now states the three facts somebody hesitating at a sign in
 * form actually wants: what this is, that the keys are theirs, and that no real
 * money is involved yet.
 *
 * None of the logic below changed. The registration flow, the six digit code,
 * the expiry distinction and the Turnstile token handling are exactly as they
 * were, because they were correct.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEMO = { email: "demo@ledgerwatch.app", password: "demo1234" };

export default function AuthPage() {
  const { login, register, verifyEmail, resendCode } = useAuth();
  const [mode, setMode] = useState("login"); // "login" | "register"
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    accountName: "",
    accountNumber: "",
    bankName: "",
  });
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [bankOpen, setBankOpen] = useState(false);
  const [tsToken, setTsToken] = useState("");
  // Remounts the widget for a fresh token. Cloudflare tokens are single use, so
  // after any failed submit the old one is already spent.
  const [tsKey, setTsKey] = useState(0);
  // When set, registration succeeded and the account is waiting on its code.
  const [pending, setPending] = useState(null);
  const [code, setCode] = useState("");
  const [codeExpired, setCodeExpired] = useState(false);
  const [notice, setNotice] = useState("");

  const isRegister = mode === "register";

  const update = (k) => (e) => {
    const v = e.target.value;
    setForm((f) => ({ ...f, [k]: v }));
    if (fieldErrors[k]) setFieldErrors((fe) => ({ ...fe, [k]: undefined }));
  };

  function switchMode(next) {
    setMode(next);
    setError("");
    setFieldErrors({});
    resetTurnstile();
  }

  function resetTurnstile() {
    setTsToken("");
    setTsKey((k) => k + 1);
  }

  function validate() {
    const errs = {};
    if (isRegister && !form.name.trim()) errs.name = "Enter your name";
    if (!EMAIL_RE.test(form.email.trim())) errs.email = "Enter a valid email address";
    if (form.password.length < 6) errs.password = "Must be at least 6 characters";
    return errs;
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    const errs = validate();
    if (Object.keys(errs).length) {
      setFieldErrors(errs);
      return;
    }
    setBusy(true);
    try {
      if (isRegister) {
        const payload = {
          name: form.name,
          email: form.email,
          password: form.password,
        };
        if (form.accountName || form.accountNumber || form.bankName) {
          payload.bankDetails = {
            accountName: form.accountName,
            accountNumber: form.accountNumber,
            bankName: form.bankName,
          };
        }
        payload.turnstileToken = tsToken;
        const res = await register(payload);
        if (res && res.verificationRequired) {
          setPending({ email: res.email || form.email });
          setNotice(
            res.emailSent === false
              ? res.error || "We could not send the code. Use Send a new code below."
              : ""
          );
          return;
        }
      } else {
        await login(form.email, form.password, tsToken);
      }
    } catch (err) {
      const data = err?.response?.data;
      // An account that never confirmed its email: the server has already sent a
      // fresh code, so go straight to the code screen rather than showing an
      // error the person cannot act on from here.
      if (data && data.verificationRequired) {
        setPending({ email: data.email || form.email });
        setNotice(data.error || "");
        return;
      }
      setError(data?.error || "Something went wrong. Please try again.");
      resetTurnstile(); // the token is spent either way
    } finally {
      setBusy(false);
    }
  }

  async function onVerify(e) {
    e.preventDefault();
    setError("");
    setNotice("");
    if (!/^\d{6}$/.test(code.trim())) {
      setError("Enter the six digit code from your email.");
      return;
    }
    setBusy(true);
    try {
      await verifyEmail(pending.email, code.trim());
    } catch (err) {
      const data = err?.response?.data;
      setError(data?.error || "Could not confirm that code.");
      // An expired code is a different problem from a wrong one: the digits may
      // be perfectly correct. Surfacing that distinction is the difference
      // between "ask for a new one" and "check what you typed".
      setCodeExpired(Boolean(data?.expired));
    } finally {
      setBusy(false);
    }
  }

  async function onResend() {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      await resendCode(pending.email);
      setCode("");
      setCodeExpired(false);
      setNotice("A new code is on its way. It is valid for thirty minutes.");
    } catch (err) {
      setError(err?.response?.data?.error || "Could not send a new code.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="gate">
      <aside className="gate-aside">
        <Link to="/" className="lw-brand" style={{ color: "#fff" }}>
          <LogoMark size={32} />
          <span className="lw-brand-name" style={{ color: "#fff" }}>
            Ledger<em style={{ color: "var(--gold-400)" }}>Watch</em>
          </span>
        </Link>

        <div className="gate-quote">
          <h2>The work is finished. The money should not still be waiting.</h2>
          <p>
            LedgerWatch keeps the book, writes the message nobody wants to write, and closes the
            invoice the moment the payment lands.
          </p>
        </div>

        <div className="gate-facts">
          <div className="gate-fact">
            <span className="k">Your keys</span>
            <span className="v">Stay yours</span>
          </div>
          <div className="gate-fact">
            <span className="k">Every action</span>
            <span className="v">You approve</span>
          </div>
          <div className="gate-fact">
            <span className="k">Networks</span>
            <span className="v">Test only</span>
          </div>
        </div>
      </aside>

      <main className="gate-main">
        <div className="gate-form">
          <Link to="/" className="lw-brand gate-brand-sm" aria-label="LedgerWatch home">
            <LogoMark size={34} />
            <span className="lw-brand-name">
              Ledger<em>Watch</em>
            </span>
          </Link>

          <h1>{pending ? "Check your email" : isRegister ? "Create your account" : "Sign in"}</h1>
          <p className="sub">
            {pending
              ? `We sent a six digit code to ${pending.email}. It is good for thirty minutes.`
              : isRegister
                ? "Put your first debtor in and see whether it earns its place."
                : "Welcome back. Your ledger is where you left it."}
          </p>

          {error && (
            <div className="alert alert-error" role="alert" style={{ marginBottom: 16 }}>
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          {notice && (
            <div className="alert" role="status" style={{ marginBottom: 16 }}>
              <span>{notice}</span>
            </div>
          )}

          {pending && (
            <form onSubmit={onVerify} className="stack-sm" noValidate>
              <Field label="Six digit code">
                <Input
                  value={code}
                  onChange={(e) => {
                    // Digits only. Pasting from a mail client often brings spaces
                    // along, and a code that looks right but fails is the most
                    // frustrating possible outcome here.
                    setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
                    setCodeExpired(false);
                  }}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="000000"
                  className="input gate-code"
                />
              </Field>

              {codeExpired && (
                <p className="field-hint" style={{ margin: 0 }}>
                  That code has run out. Ask for a new one below and it will arrive in a moment.
                </p>
              )}

              <Button variant="primary" type="submit" block loading={busy} style={{ marginTop: 6 }}>
                Confirm and continue
              </Button>

              <div className="gate-alt">
                <button type="button" className="linklike" onClick={onResend} disabled={busy}>
                  Send a new code
                </button>
                <button
                  type="button"
                  className="linklike"
                  onClick={() => {
                    setPending(null);
                    setCode("");
                    setCodeExpired(false);
                    setNotice("");
                    setError("");
                    resetTurnstile();
                  }}
                >
                  Use a different email
                </button>
              </div>
            </form>
          )}

          {!pending && (
            <>
              {!isRegister && (
                <div className="gate-demo">
                  <div className="grow">
                    <span className="lw-label">Have a look around first</span>
                    <div className="muted caption num">
                      {DEMO.email} &middot; {DEMO.password}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => {
                      setForm((f) => ({
                        ...f,
                        email: DEMO.email,
                        password: DEMO.password,
                      }));
                      setFieldErrors({});
                      setError("");
                    }}
                  >
                    <Wand2 size={13} /> Fill it in
                  </Button>
                </div>
              )}

              <form onSubmit={onSubmit} className="stack-sm" noValidate>
                {isRegister && (
                  <Field label="Full name" error={fieldErrors.name}>
                    <Input
                      value={form.name}
                      onChange={update("name")}
                      autoComplete="name"
                      placeholder="Ada Okoye"
                    />
                  </Field>
                )}
                <Field label="Email" error={fieldErrors.email}>
                  <Input
                    type="email"
                    value={form.email}
                    onChange={update("email")}
                    autoComplete="email"
                    placeholder="you@company.com"
                  />
                </Field>
                <Field label="Password" error={fieldErrors.password}>
                  <Input
                    type="password"
                    value={form.password}
                    onChange={update("password")}
                    autoComplete={isRegister ? "new-password" : "current-password"}
                    placeholder={isRegister ? "At least 6 characters" : "Your password"}
                  />
                </Field>

                {isRegister && (
                  <div className="disclosure">
                    <button
                      type="button"
                      className="disclosure-toggle"
                      aria-expanded={bankOpen}
                      onClick={() => setBankOpen((o) => !o)}
                    >
                      <span>
                        Bank details <span className="opt">(optional)</span>
                      </span>
                      <ChevronDown size={16} />
                    </button>
                    {bankOpen && (
                      <div className="disclosure-body stack-sm">
                        <p className="muted caption" style={{ margin: "0 0 4px" }}>
                          These go inside every reminder, so a debtor never has to ask where to
                          send it.
                        </p>
                        <Field label="Account name">
                          <Input value={form.accountName} onChange={update("accountName")} />
                        </Field>
                        <Field label="Account number">
                          <Input
                            value={form.accountNumber}
                            onChange={update("accountNumber")}
                            inputMode="numeric"
                          />
                        </Field>
                        <Field label="Bank name">
                          <Input value={form.bankName} onChange={update("bankName")} />
                        </Field>
                      </div>
                    )}
                  </div>
                )}

                {/* Under the last input, above the action. The person must tick
                    it before the button will do anything. */}
                <Turnstile
                  key={tsKey}
                  action={isRegister ? "signup" : "login"}
                  onToken={setTsToken}
                />

                <Button
                  variant="primary"
                  type="submit"
                  block
                  loading={busy}
                  disabled={turnstileEnabled && !tsToken}
                  style={{ marginTop: 6 }}
                >
                  {busy
                    ? isRegister
                      ? "Creating your account..."
                      : "Signing you in..."
                    : isRegister
                      ? "Create account"
                      : "Sign in"}
                </Button>
              </form>

              <div className="gate-rule">
                <span>{isRegister ? "Already have an account" : "New to LedgerWatch"}</span>
              </div>

              <Button block onClick={() => switchMode(isRegister ? "login" : "register")}>
                {isRegister ? "Sign in instead" : "Create an account"}
              </Button>
            </>
          )}

          <p className="gate-foot">
            <Link to="/">Back to the front page</Link>
          </p>
        </div>
      </main>
    </div>
  );
}
