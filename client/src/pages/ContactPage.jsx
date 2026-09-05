import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, CheckCircle2, ShieldAlert } from "lucide-react";
import http from "../api/http";
import { useAuth } from "../context/AuthContext";
import { Button, Field, Input, Select } from "../components/ui";
import PublicShell from "../components/PublicShell";
import Turnstile, { turnstileEnabled, unloadTurnstile } from "../components/Turnstile";

const TOPICS = [
  { id: "payment", label: "A payment or an invoice" },
  { id: "wallet", label: "The wallet" },
  { id: "market", label: "Market Watch or a trade" },
  { id: "account", label: "My account or signing in" },
  { id: "security", label: "A security concern" },
  { id: "other", label: "Something else" },
];

/**
 * THE CONTACT PAGE
 *
 * A form that reaches the person who built this. Public, because the person
 * most in need of it is often the one who cannot sign in. Signed in users get
 * their name and email filled in.
 *
 * The hidden `website` field is a honeypot: no person sees it, a bot fills it,
 * and the server quietly discards anything that arrives with it set.
 */
export default function ContactPage() {
  const { user } = useAuth();
  const [form, setForm] = useState({
    name: user?.name || "",
    email: user?.email || "",
    topic: "other",
    message: "",
    website: "",
  });
  const [tsToken, setTsToken] = useState("");
  const [tsKey, setTsKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  useEffect(() => {
    document.title = "Contact · LedgerWatch";
    return () => {
      document.title = "LedgerWatch: Automated receivables and market monitoring";
      unloadTurnstile();
    };
  }, []);

  useEffect(() => {
    if (!user) return;
    setForm((f) => ({ ...f, name: f.name || user.name || "", email: f.email || user.email || "" }));
  }, [user]);

  const update = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (!form.name.trim()) return setError("Tell me your name.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      return setError("Enter a valid email address so I can reply.");
    }
    if (form.message.trim().length < 10) {
      return setError("Say a little more about what happened.");
    }
    setBusy(true);
    try {
      await http.post("/api/contact", {
        ...form,
        page: sessionStorage.getItem("ledgerwatch.contact.from") || "",
        turnstileToken: tsToken,
      });
      setSent(true);
    } catch (err) {
      const status = err?.response?.status;
      setError(
        err?.response?.data?.error ||
          (status === 429
            ? "You have sent a few messages already. Please wait a while before sending another."
            : "The message could not be sent. Check your connection and try again.")
      );
      setTsToken("");
      setTsKey((k) => k + 1);
    } finally {
      setBusy(false);
    }
  }

  return (
    <PublicShell>
      <div className="contact">
        <div>
          <h1 className="contact-title">Contact</h1>
          <p className="contact-lead">
            Something not working, a payment that has not shown up, or a question the{" "}
            <Link to="/docs">guide</Link> did not answer. Write to me here and I will reply by email.
          </p>

          {sent ? (
            <div className="contact-done" role="status">
              <CheckCircle2 size={22} />
              <div>
                <h2>Thank you. Your message has been received.</h2>
                <p>
                  I read every message myself and reply to <strong>{form.email.trim()}</strong>, usually
                  within a day. If it is about money that has gone missing, keep the transaction hash
                  and the network handy, because that is the first thing I will ask for.
                </p>
                <div className="row wrap">
                  <Link to="/docs" className="btn">
                    Read the guide
                  </Link>
                  <Link to={user ? "/app" : "/"} className="btn btn-primary">
                    {user ? "Back to LedgerWatch" : "Back to the front page"}
                  </Link>
                </div>
              </div>
            </div>
          ) : (
            <form className="contact-form stack" onSubmit={submit} noValidate>
              <div className="grid2">
                <Field label="Your name">
                  <Input value={form.name} onChange={update("name")} autoComplete="name" required />
                </Field>
                <Field label="Your email">
                  <Input
                    type="email"
                    value={form.email}
                    onChange={update("email")}
                    autoComplete="email"
                    placeholder="you@company.com"
                    required
                  />
                </Field>
              </div>

              <Field label="What is this about">
                <Select value={form.topic} onChange={update("topic")}>
                  {TOPICS.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Your message">
                <textarea
                  className="input"
                  rows={7}
                  value={form.message}
                  onChange={update("message")}
                  placeholder="What happened, what you expected, and when. For a payment or a transaction, include the network and the transaction hash."
                  required
                />
              </Field>

              {/* The honeypot. Hidden from people, visible to scripts. */}
              <div className="contact-hp" aria-hidden="true">
                <label htmlFor="contact-website">Website</label>
                <input
                  id="contact-website"
                  type="text"
                  name="website"
                  tabIndex={-1}
                  autoComplete="off"
                  value={form.website}
                  onChange={update("website")}
                />
              </div>

              <p className="settings-note danger">
                <ShieldAlert size={15} />
                Never include your password, your recovery phrase or a private key. I will never ask
                for them, and a message that contains one is refused.
              </p>

              <Turnstile key={tsKey} action="contact" onToken={setTsToken} />

              {error && (
                <div className="alert alert-error" role="alert">
                  <AlertCircle size={16} />
                  <span>{error}</span>
                </div>
              )}

              <div className="row" style={{ justifyContent: "flex-end" }}>
                <Button
                  variant="primary"
                  type="submit"
                  loading={busy}
                  disabled={turnstileEnabled && !tsToken}
                >
                  {busy ? "Sending..." : "Send message"}
                </Button>
              </div>
            </form>
          )}
        </div>

        <aside className="contact-aside">
          <div className="contact-aside-block">
            <h3>Before you write</h3>
            <p>
              The <Link to="/docs/troubleshooting">troubleshooting page</Link> covers the problems people
              run into most: a balance that reads as unavailable, a sign in code that has not arrived,
              a payment that has not been detected yet.
            </p>
          </div>
          <div className="contact-aside-block">
            <h3>Reporting a security problem</h3>
            <p>
              Choose <strong>A security concern</strong> above and describe what you found. Please do
              not post it publicly until I have had a chance to fix it.
            </p>
          </div>
          <div className="contact-aside-block">
            <h3>What I cannot do</h3>
            <p>
              Your wallet keys never reach me, so I cannot reverse a transaction, recover a lost
              recovery phrase, or reset a wallet password. The{" "}
              <Link to="/docs/safety">safety page</Link> explains why that is the point.
            </p>
          </div>
        </aside>
      </div>
    </PublicShell>
  );
}
