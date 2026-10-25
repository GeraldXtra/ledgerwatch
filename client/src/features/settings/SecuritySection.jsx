import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import http, { setToken } from "../../api/http";
import { Button, Field, Input, useToast } from "../../components/ui";
import TwoFactorCard from "./TwoFactorCard";
import EmailChangeCard from "./EmailChangeCard";

export default function SecuritySection() {
  const toast = useToast();
  const [pw, setPw] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const set = (k) => (e) => setPw((p) => ({ ...p, [k]: e.target.value }));

  async function changePassword(e) {
    e.preventDefault();
    setError("");
    if (pw.newPassword.length < 8) {
      return setError("Your new password must be at least 8 characters.");
    }
    if (pw.newPassword !== pw.confirm) {
      return setError("The new passwords do not match.");
    }
    if (pw.newPassword === pw.currentPassword) {
      return setError("Your new password must be different from the current one.");
    }
    setBusy(true);
    try {
      const { data } = await http.post("/api/auth/me/password", {
        currentPassword: pw.currentPassword,
        newPassword: pw.newPassword,
      });
      if (data && data.token) setToken(data.token);
      setPw({ currentPassword: "", newPassword: "", confirm: "" });
      toast("Password changed. Other devices have been signed out.", { type: "success" });
    } catch (err) {
      setError(err?.response?.data?.error || "Could not change your password");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="settings-head">
        <h2 className="section-title">Security</h2>
        <p className="muted small">Your sign in email, your password and two-step sign-in.</p>
      </div>

      <form className="stack" onSubmit={changePassword}>
        <div className="grid2">
          <Field label="Current password">
            <Input
              type="password"
              value={pw.currentPassword}
              onChange={set("currentPassword")}
              autoComplete="current-password"
              required
            />
          </Field>
          <span />
          <Field label="New password">
            <Input
              type="password"
              value={pw.newPassword}
              onChange={set("newPassword")}
              autoComplete="new-password"
              required
            />
          </Field>
          <Field label="Confirm new password">
            <Input
              type="password"
              value={pw.confirm}
              onChange={set("confirm")}
              autoComplete="new-password"
              required
            />
          </Field>
        </div>
        {error && <p className="error-text">{error}</p>}
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <Button variant="primary" type="submit" disabled={busy}>
            {busy ? "Changing…" : "Change password"}
          </Button>
        </div>
      </form>

      <hr className="settings-rule" />
      <TwoFactorCard />

      <hr className="settings-rule" />
      <EmailChangeCard />

      <p className="settings-note">
        <ShieldCheck size={15} />
        Your wallet key is encrypted in your browser and never leaves this device. Changing
        this password does not affect it.
      </p>
    </div>
  );
}
