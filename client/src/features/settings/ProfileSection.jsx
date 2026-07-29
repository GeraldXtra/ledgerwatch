import { useState } from "react";
import { Button, Field, Input, useToast } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import AvatarUpload from "./AvatarUpload";

export default function ProfileSection() {
  const { user, updateProfile } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(user.name || "");
  const [companyName, setCompanyName] = useState(user.companyName || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const dirty =
    name.trim() !== (user.name || "") || companyName.trim() !== (user.companyName || "");

  async function save(e) {
    e.preventDefault();
    setError("");
    if (!name.trim()) return setError("Your name cannot be empty.");
    setBusy(true);
    try {
      await updateProfile({ name: name.trim(), companyName: companyName.trim() });
      toast("Profile saved.", { type: "success" });
    } catch (err) {
      setError(err?.response?.data?.error || "Could not save your profile");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="settings-head">
        <h2 className="section-title">Profile</h2>
        <p className="muted small">Your picture and details appear across LedgerWatch.</p>
      </div>

      <AvatarUpload />

      <form className="stack" onSubmit={save}>
        <div className="grid2">
          <Field label="Display name">
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field label="Company name">
            <Input
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Appears on reminders and statements"
            />
          </Field>
          <Field label="Email">
            <Input value={user.email} readOnly disabled />
          </Field>
        </div>
        {error && <p className="error-text">{error}</p>}
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <Button variant="primary" type="submit" disabled={busy || !dirty}>
            {busy ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </form>
    </div>
  );
}
