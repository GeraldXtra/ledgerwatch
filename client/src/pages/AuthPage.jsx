import { useEffect, useState } from "react";
import { AlertCircle, ChevronDown } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import http from "../api/http";
import { Button, Field, Input } from "../components/ui";
import LogoMark from "../components/LogoMark";
import Turnstile, { turnstileEnabled, unloadTurnstile } from "../components/Turnstile";

/**
 * The nonce that ties a Google sign in to the browser that started it. Session
 * storage, so it dies with the tab and never follows a link anywhere. Random
 * bytes from the platform generator, never Math.random; a nonce that can be
 * guessed is not a nonce.
 */
const OAUTH_NONCE_KEY = "ledgerwatch.oauth.nonce";

function mintOauthNonce() {
  const bytes = new Uint8Array(24);
  window.crypto.getRandomValues(bytes);
  const n = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  try {
    sessionStorage.setItem(OAUTH_NONCE_KEY, n);
  } catch {
    /* private mode with storage disabled: the callback is then refused, which is
       the safe direction, and the password form still works */
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
    /* nothing to clear */
  }
}

/** Google's four colour mark, inline so nothing is fetched from anywhere. */
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
  } = useAuth();
  const [mode, setMode] = useState("login"); // "login" | "register" | "forgot" | "reset"
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
  // Password reset: the address the code went to, the code, and the new
  // password typed twice.
  const [resetEmail, setResetEmail] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const isRegister = mode === "register";
  const isForgot = mode === "forgot";
  const isReset = mode === "reset";

  // Leaving this page removes the Cloudflare widget script from the document,
  // so it is not resident when the wallet asks for a keystore password.
  useEffect(() => () => unloadTurnstile(), []);

  /**
   * Sign in with Google lands back here with the outcome in the URL FRAGMENT:
   * `#token=...` on success, `#error=...` otherwise. A fragment never reaches
   * a server or a log, which is the point when it carries a session token. It
   * is cleared from the address bar immediately so a reload or a back press
   * cannot replay it.
   */
  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, "");
    if (!hash) return;
    const params = new URLSearchParams(hash);
    const token = params.get("token");
    const oauthError = params.get("error");
    if (!token && !oauthError) return;
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    if (oauthError) {
      setError(oauthError);
      return;
    }
    /**
     * ONLY A FLOW THIS BROWSER STARTED MAY SIGN IT IN.
     *
     * A token in a fragment can be put there by anyone: a link reading
     * `/login#token=...` sent to somebody would have stored the sender's
     * session in the recipient's browser, and everything they then entered
     * would have landed in the sender's account. So the click that starts
     * Google sign in mints a nonce and keeps it here; the server folds it into
     * its signed state and hands it back beside the token; and a token that
     * arrives without the nonce this browser is holding is thrown away.
     */
    const expected = readOauthNonce();
    const given = params.get("n") || "";
    clearOauthNonce();
    if (!expected || given !== expected) {
      setError(
        "That sign in did not start in this browser, so it was not used. Press Continue with Google here to sign in."
      );
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

  // ---- password reset ----

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
      // No session was issued. The proof that the reset worked is signing in
      // with the new password, so that is where the person is sent.
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
            {pending
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
            {pending
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

          {!pending && isForgot && (
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

          {!pending && isReset && (
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

          {!pending && !isForgot && !isReset && (
            <>
              {/* The shared demo account is no longer offered here. It printed a
                  working email and password on the public sign-in page with a
                  button that filled them in, which invited anyone who found the
                  site to sign in as that account. It is the owner's own account
                  for testing, not a product feature. The credentials still work
                  for whoever knows them; they are simply not advertised. */}

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
                <span>or</span>
              </div>

              {/* A plain navigation to the server, which redirects to Google
                  and back. No Google script runs in this page, on purpose:
                  this page's origin is the one that decrypts private keys. The
                  click mints the browser nonce the callback must return. */}
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
