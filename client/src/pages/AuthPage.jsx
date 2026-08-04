import { useState } from "react";
import {
  AlertCircle,
  BellRing,
  ChevronDown,
  Receipt,
  ShieldCheck,
  Wand2,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Button, Field, Input } from "../components/ui";
import LogoMark from "../components/LogoMark";
import DashboardMockup from "../components/landing/DashboardMockup";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEMO = { email: "demo@ledgerwatch.app", password: "leobl4ze" };

export default function AuthPage() {
  const { login, register } = useAuth();
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
  }

  function validate() {
    const errs = {};
    if (isRegister && !form.name.trim()) errs.name = "Enter your name";
    if (!EMAIL_RE.test(form.email.trim()))
      errs.email = "Enter a valid email address";
    if (form.password.length < 6)
      errs.password = "Must be at least 6 characters";
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
        await register(payload);
      } else {
        await login(form.email, form.password);
      }
    } catch (err) {
      setError(
        err?.response?.data?.error || "Something went wrong. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-split">
      <div className="auth-left">
        <div className="auth-card">
          <div className="auth-panel">
            <Link to="/" className="auth-brand" aria-label="LedgerWatch home">
              <LogoMark size={42} />
              <span className="wordmark">
                Ledger<span className="tick">Watch</span>
              </span>
            </Link>

            <div className="auth-head">
              <div className="auth-title">
                {isRegister ? "Create your account" : "Sign in"}
              </div>
              <div className="auth-subtitle">
                {isRegister
                  ? "Start tracking receivables and watching the market."
                  : "Welcome back — sign in to your workspace."}
              </div>
            </div>

            {error && (
              <div
                className="alert alert-error"
                role="alert"
                style={{ marginBottom: 16 }}
              >
                <AlertCircle size={16} />
                <span>{error}</span>
              </div>
            )}

            {!isRegister && (
              <div className="demo-hint">
                <div className="grow">
                  <div className="demo-hint-title">Try the live demo</div>
                  <div className="muted caption num">
                    {DEMO.email} · {DEMO.password}
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
                  <Wand2 size={13} /> Use demo
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
                  autoComplete={
                    isRegister ? "new-password" : "current-password"
                  }
                  placeholder={
                    isRegister ? "At least 6 characters" : "••••••••"
                  }
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
                      <p
                        className="muted caption"
                        style={{ margin: "0 0 4px" }}
                      >
                        Shown inside payment reminders so debtors know where to
                        pay.
                      </p>
                      <Field label="Account name">
                        <Input
                          value={form.accountName}
                          onChange={update("accountName")}
                        />
                      </Field>
                      <Field label="Account number">
                        <Input
                          value={form.accountNumber}
                          onChange={update("accountNumber")}
                          inputMode="numeric"
                        />
                      </Field>
                      <Field label="Bank name">
                        <Input
                          value={form.bankName}
                          onChange={update("bankName")}
                        />
                      </Field>
                    </div>
                  )}
                </div>
              )}

              <Button
                variant="primary"
                type="submit"
                block
                loading={busy}
                style={{ marginTop: 6 }}
              >
                {busy
                  ? isRegister
                    ? "Creating account..."
                    : "Signing in..."
                  : isRegister
                  ? "Create account"
                  : "Sign in"}
              </Button>
            </form>

            <div className="auth-divider" style={{ marginTop: 18 }}>
              {isRegister ? "Already have an account?" : "New to LedgerWatch?"}
            </div>

            <Button
              block
              onClick={() => switchMode(isRegister ? "login" : "register")}
              style={{ marginTop: 12 }}
            >
              {isRegister ? "Sign in instead" : "Create an account"}
            </Button>
          </div>

          <p className="auth-foot">
            LedgerWatch — get paid on time, watch the market.
            <br />
            <Link to="/" className="demo">
              Back to home
            </Link>
          </p>
        </div>
      </div>

      <aside className="auth-right" aria-hidden="true">
        <div className="auth-brand-panel">
          <div className="auth-brand-top">
            <LogoMark size={40} />
            <span className="wordmark on-navy">
              Ledger<span className="tick">Watch</span>
            </span>
          </div>

          <h2 className="auth-vp">Money you're owed, chased automatically.</h2>
          <p className="auth-vp-sub">
            Track every debt, remind every debtor, and watch the market — with
            an agent that prepares the work and lets you approve it.
          </p>

          <ul className="auth-benefits">
            <li>
              <span className="ab-ic">
                <Receipt size={16} />
              </span>
              Track debts and part-payments in one ledger
            </li>
            <li>
              <span className="ab-ic">
                <BellRing size={16} />
              </span>
              Reminders drafted and sent for you
            </li>
            <li>
              <span className="ab-ic">
                <ShieldCheck size={16} />
              </span>
              You approve every outward action
            </li>
          </ul>

          <div className="auth-preview">
            <DashboardMockup />
          </div>
        </div>
      </aside>
    </div>
  );
}
