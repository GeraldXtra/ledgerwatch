import { useState } from "react";
import { Mail } from "lucide-react";
import http from "../../api/http";
import { useAuth } from "../../context/AuthContext";
import { Button, Field, Input, useToast } from "../../components/ui";

export default function EmailChangeCard() {
  const { user, applyUser, applySession } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({ newEmail: "", password: "", code: "" });
  const [confirmCode, setConfirmCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);

  const pending = user?.pendingEmail || null;
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function run(fn) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (err) {
      setError(err?.response?.data?.error || "That could not be done just now. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  const start = (e) =>
    run(async () => {
      e.preventDefault();
      const { data } = await http.post("/api/auth/me/email", {
        newEmail: form.newEmail.trim(),
        password: form.password,
        ...(user?.twoFactorEnabled ? { code: form.code } : {}),
      });
      if (data.user && applyUser) applyUser(data.user);
      setForm({ newEmail: "", password: "", code: "" });
      setOpen(false);
      toast(`A code is on its way to ${data.pendingEmail}.`, { type: "info" });
    });

  const confirm = (e) =>
    run(async () => {
      e.preventDefault();
      const { data } = await http.post("/api/auth/me/email/confirm", { code: confirmCode.trim() });
      applySession(data.token, data.user);
      setConfirmCode("");
      toast(`You now sign in with ${data.user.email}. Other devices have been signed out.`, { type: "success" });
    });

  const cancel = () =>
    run(async () => {
      const { data } = await http.delete("/api/auth/me/email");
      if (data.user && applyUser) applyUser(data.user);
      setConfirmCode("");
    });

  return (
    <div className="stack-sm">
      <div className="settings-head">
        <h3 className="card-title">Sign in email</h3>
        <p className="muted small">
          You sign in with <strong>{user?.email}</strong>. Receipts, codes and notices go there too.
        </p>
      </div>

      {pending ? (
        <form className="stack-sm" onSubmit={confirm}>
          <p className="row tight">
            <Mail size={16} /> Enter the code we sent to {pending} to finish the change.
          </p>
          <Field label="Six digit code">
            <Input
              value={confirmCode}
              onChange={(e) => setConfirmCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              required
            />
          </Field>
          <div className="row wrap">
            <Button variant="primary" type="submit" disabled={busy}>
              Change my email
            </Button>
            <Button variant="ghost" type="button" onClick={cancel} disabled={busy}>
              Keep my current email
            </Button>
          </div>
        </form>
      ) : open ? (
        <form className="stack-sm" onSubmit={start}>
          <div className="grid2">
            <Field label="New email">
              <Input type="email" value={form.newEmail} onChange={set("newEmail")} autoComplete="email" required />
            </Field>
            <Field label="Your LedgerWatch password">
              <Input type="password" value={form.password} onChange={set("password")} autoComplete="current-password" required />
            </Field>
            {user?.twoFactorEnabled && (
              <Field label="A code from your authenticator app">
                <Input
                  value={form.code}
                  onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.replace(/[^a-zA-Z0-9]/g, "").slice(0, 10) }))}
                  autoComplete="one-time-code"
                  required
                />
              </Field>
            )}
          </div>
          <p className="muted small">
            Nothing changes until you enter the code we send to the new address. Your current address is told when the
            change happens.
          </p>
          <div className="row wrap">
            <Button variant="primary" type="submit" disabled={busy}>
              Send the code
            </Button>
            <Button variant="ghost" type="button" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="row wrap">
          <Button onClick={() => setOpen(true)}>Change email</Button>
        </div>
      )}

      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
