import { useEffect, useState } from "react";
import { AlertCircle, ChevronDown } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import http from "../api/http";
import { Button, Field, Input } from "../components/ui";
import LogoMark from "../components/LogoMark";
import Turnstile, { turnstileEnabled, unloadTurnstile } from "../components/Turnstile";

const OAUTH_NONCE_KEY = "ledgerwatch.oauth.nonce";

function mintOauthNonce() {
  const bytes = new Uint8Array(24);
  window.crypto.getRandomValues(bytes);
  const n = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  try {
    sessionStorage.setItem(OAUTH_NONCE_KEY, n);
  } catch {
  }
  return n;
}

function readOauthNonce() {
  try {
    return sessionStorage.getItem(OAUTH_NONCE_KEY) || "";
  } catch {
    return "";
  }
}

function clearOauthNonce() {
  try {
    sessionStorage.removeItem(OAUTH_NONCE_KEY);
  } catch {
  }
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function AuthPage() {
  const {
    login,
    register,
    verifyEmail,
    resendCode,
    forgotPassword,
    resendResetCode,
    resetPassword,
    loginWithToken,
    loginSecondFactor,
  } = useAuth();
  const [mode, setMode] = useState("login");
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
  const [tsKey, setTsKey] = useState(0);
  const [pending, setPending] = useState(null);
  const [code, setCode] = useState("");
  const [codeExpired, setCodeExpired] = useState(false);
  const [notice, setNotice] = useState("");
  const [resetEmail, setResetEmail] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [secondStep, setSecondStep] = useState(null);
  const [secondCode, setSecondCode] = useState("");

  const isRegister = mode === "register";
  const isForgot = mode === "forgot";
  const isReset = mode === "reset";

  useEffect(() => () => unloadTurnstile(), []);

  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, "");
    if (!hash) return;
    const params = new URLSearchParams(hash);
    const token = params.get("token");
    const challenge = params.get("challenge");
    const oauthError = params.get("error");
    if (!token && !challenge && !oauthError) return;
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    if (oauthError) {
      setError(oauthError);
      return;
    }
    const expected = readOauthNonce();
    const given = params.get("n") || "";
    clearOauthNonce();
    if (!expected || given !== expected) {
      setError(
        "That sign in did not start in this browser, so it was not used. Press Continue with Google here to sign in."
      );
      return;
    }
    if (challenge) {
      setSecondStep({ challenge });
      return;
    }
    setBusy(true);
    loginWithToken(token)
      .catch(() =>
        setError("Google signed you in, but the account could not be loaded. Please try again.")
      )
      .finally(() => setBusy(false));
  }, [loginWithToken]);

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
    if (isRegister && form.password.length < 8) {
      errs.password = "Must be at least 8 characters";
    } else if (!isRegister && !form.password) {
      errs.password = "Enter your password";
    }
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
        const res = await login(form.email, form.password, tsToken);
        if (res && res.twoFactorRequired) {
          setSecondStep({ challenge: res.challenge });
          setSecondCode("");
        }
      }
    } catch (err) {
      const data = err?.response?.data;
      if (data && data.verificationRequired) {
        setPending({ email: data.email || form.email });
        setNotice(data.error || "");
        return;
      }
      setError(data?.error || "Something went wrong. Please try again.");
      resetTurnstile();
    } finally {
      setBusy(false);
    }
  }

  async function onSecondStep(e) {
    e.preventDefault();
    setError("");
    const given = secondCode.replace(/\s+/g, "");
    if (!/^\d{6}$/.test(given) && !/^[a-zA-Z0-9]{10}$/.test(given)) {
      setError("Enter the six digit code from your authenticator app, or one of your ten character backup codes.");
      return;
    }
    setBusy(true);
    try {
      const data = await loginSecondFactor(secondStep.challenge, given);
      if (data.backupCodesLeft != null) {
        setNotice(`You used a backup code. ${data.backupCodesLeft} left.`);
      }
    } catch (err) {
      const data = err?.response?.data;
      setError(data?.error || "That code could not be checked. Please try again.");
      if (data && data.restart) {
        setSecondStep(null);
        setSecondCode("");
        resetTurnstile();
      }
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

  async function onForgot(e) {
    e.preventDefault();
    setError("");
    setNotice("");
    const email = form.email.trim();
    if (!EMAIL_RE.test(email)) {
      setFieldErrors({ email: "Enter a valid email address" });
      return;
    }
    setBusy(true);
    try {
      const res = await forgotPassword(email, tsToken);
      setResetEmail(email);
      setResetCode("");
      setNewPassword("");
      setConfirmPassword("");
      setCodeExpired(false);
      setFieldErrors({});
      setMode("reset");
      setNotice(
        res?.emailSent === false
          ? "We could not send the code. Use Send a new code below."
          : ""
      );
    } catch (err) {
      setError(err?.response?.data?.error || "Could not send a reset code.");
      resetTurnstile();
    } finally {
      setBusy(false);
    }
  }

  async function onResendReset() {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      await resendResetCode(resetEmail);
      setResetCode("");
      setCodeExpired(false);
      setNotice("A new code is on its way. It is valid for fifteen minutes.");
    } catch (err) {
      setError(err?.response?.data?.error || "Could not send a new code.");
    } finally {
      setBusy(false);
    }
  }

  async function onReset(e) {
    e.preventDefault();
    setError("");
    setNotice("");
    if (!/^\d{6}$/.test(resetCode.trim())) {
      setError("Enter the six digit code from your email.");
      return;
    }
    if (newPassword.length < 8) {
      setFieldErrors({ newPassword: "Must be at least 8 characters" });
      return;
    }
    if (newPassword !== confirmPassword) {
      setFieldErrors({ confirmPassword: "The two passwords do not match" });
      return;
    }
    setBusy(true);
    try {
      await resetPassword(resetEmail, resetCode.trim(), newPassword);
      setMode("login");
      setForm((f) => ({ ...f, email: resetEmail, password: "" }));
      setResetCode("");
      setNewPassword("");
      setConfirmPassword("");
      setFieldErrors({});
      setNotice("Your password has been changed. Sign in with the new one.");
      resetTurnstile();
    } catch (err) {
      const data = err?.response?.data;
      setError(data?.error || "Could not change the password.");
      setCodeExpired(Boolean(data?.expired));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="gate">
      <aside className="gate-aside">
        <Link to="/" className="lw-brand">
          <LogoMark size={32} />
          <span className="lw-brand-name">
            Ledger<em>Watch</em>
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
            <span className="v">Live</span>
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

          <h1>
            {secondStep
              ? "Enter your sign in code"
              : pending
              ? "Check your email"
              : isForgot
                ? "Reset your password"
                : isReset
                  ? "Choose a new password"
                  : isRegister
                    ? "Create your account"
                    : "Sign in"}
          </h1>
          <p className="sub">
            {secondStep
              ? "Open your authenticator app and enter the six digit code for LedgerWatch. One of your backup codes works too."
              : pending
              ? `We sent a six digit code to ${pending.email}. It is good for thirty minutes.`
              : isForgot
                ? "Enter the email on your account and we will send a six digit code."
                : isReset
                  ? `We sent a code to ${resetEmail}. It is good for fifteen minutes.`
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

          {secondStep && (
            <form onSubmit={onSecondStep} className="stack-sm" noValidate>
              <Field label="Sign in code">
                <Input
                  value={secondCode}
                  onChange={(e) => setSecondCode(e.target.value.replace(/[^a-zA-Z0-9]/g, "").slice(0, 10))}
                  autoComplete="one-time-code"
                  placeholder="000000"
                  className="input gate-code"
                  autoFocus
                />
              </Field>
              <Button variant="primary" type="submit" block loading={busy} style={{ marginTop: 6 }}>
                Sign in
              </Button>
              <div className="gate-alt">
                <button
                  type="button"
                  className="linklike"
                  onClick={() => {
                    setSecondStep(null);
                    setSecondCode("");
                    setError("");
                    resetTurnstile();
                  }}
                >
                  Start again
                </button>
              </div>
            </form>
          )}

          {!secondStep && pending && (
            <form onSubmit={onVerify} className="stack-sm" noValidate>
              <Field label="Six digit code">
                <Input
                  value={code}
                  onChange={(e) => {
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

          {!secondStep && !pending && isForgot && (
            <form onSubmit={onForgot} className="stack-sm" noValidate>
              <Field label="Email" error={fieldErrors.email}>
                <Input
                  type="email"
                  value={form.email}
                  onChange={update("email")}
                  autoComplete="email"
                  placeholder="you@company.com"
                />
              </Field>

              <Turnstile key={tsKey} action="forgot" onToken={setTsToken} />

              <Button
                variant="primary"
                type="submit"
                block
                loading={busy}
                disabled={turnstileEnabled && !tsToken}
                style={{ marginTop: 6 }}
              >
                {busy ? "Sending the code..." : "Send me a code"}
              </Button>

              <div className="gate-alt">
                <button type="button" className="linklike" onClick={() => switchMode("login")}>
                  Back to sign in
                </button>
              </div>
            </form>
          )}

          {!secondStep && !pending && isReset && (
            <form onSubmit={onReset} className="stack-sm" noValidate>
              <Field label="Six digit code">
                <Input
                  value={resetCode}
                  onChange={(e) => {
                    setResetCode(e.target.value.replace(/\D/g, "").slice(0, 6));
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

              <Field label="New password" error={fieldErrors.newPassword}>
                <Input
                  type="password"
                  value={newPassword}
                  onChange={(e) => {
                    setNewPassword(e.target.value);
                    if (fieldErrors.newPassword) setFieldErrors({});
                  }}
                  autoComplete="new-password"
                  placeholder="At least 8 characters"
                />
              </Field>
              <Field label="Confirm new password" error={fieldErrors.confirmPassword}>
                <Input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    if (fieldErrors.confirmPassword) setFieldErrors({});
                  }}
                  autoComplete="new-password"
                  placeholder="Type it again"
                />
              </Field>

              <Button variant="primary" type="submit" block loading={busy} style={{ marginTop: 6 }}>
                {busy ? "Changing your password..." : "Change password"}
              </Button>

              <div className="gate-alt">
                <button type="button" className="linklike" onClick={onResendReset} disabled={busy}>
                  Send a new code
                </button>
                <button type="button" className="linklike" onClick={() => switchMode("login")}>
                  Back to sign in
                </button>
              </div>
            </form>
          )}

          {!secondStep && !pending && !isForgot && !isReset && (
            <>

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

                {!isRegister && (
                  <div className="gate-alt" style={{ justifyContent: "flex-end", marginTop: -4 }}>
                    <button
                      type="button"
                      className="linklike"
                      onClick={() => {
                        switchMode("forgot");
                        setNotice("");
                      }}
                    >
                      Forgot your password?
                    </button>
                  </div>
                )}

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
                <span>or</span>
              </div>

              <button
                type="button"
                className="btn"
                style={{ display: "flex", width: "100%", justifyContent: "center", gap: 10 }}
                onClick={() => {
                  const n = mintOauthNonce();
                  window.location.assign(
                    `${http.defaults.baseURL}/api/auth/google?n=${encodeURIComponent(n)}`
                  );
                }}
              >
                <GoogleMark />
                {isRegister ? "Sign up with Google" : "Continue with Google"}
              </button>

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
