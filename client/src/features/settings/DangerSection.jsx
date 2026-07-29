import { useState } from "react";
import { TriangleAlert } from "lucide-react";
import http from "../../api/http";
import { Button, Input, useToast } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";

/**
 * Destructive actions, each gated behind typing an exact confirmation word, so
 * a misclick can never wipe a ledger.
 */
function DangerAction({ title, body, phrase, confirmLabel, disabled, onConfirm }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ready = !disabled && typed.trim().toUpperCase() === phrase;

  async function run() {
    if (!ready) return;
    setBusy(true);
    setError("");
    try {
      await onConfirm();
      setTyped("");
    } catch (err) {
      setError(err?.response?.data?.error || "That did not work");
      setBusy(false);
    }
  }

  return (
    <div className="danger-action">
      <div className="grow">
        <div className="card-title">{title}</div>
        <p className="muted small" style={{ margin: "4px 0 12px" }}>
          {body}
        </p>
        {!disabled && (
          <>
            <label className="muted small" htmlFor={`confirm-${phrase}`}>
              Type <strong>{phrase}</strong> to confirm
            </label>
            <div className="row" style={{ marginTop: 8 }}>
              <Input
                id={`confirm-${phrase}`}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={phrase}
                aria-label={`Type ${phrase} to confirm`}
              />
              <Button variant="danger" disabled={!ready || busy} onClick={run}>
                {busy ? "Working…" : confirmLabel}
              </Button>
            </div>
          </>
        )}
        {error && (
          <p className="error-text" style={{ marginTop: 8 }}>
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

export default function DangerSection() {
  const { user, logout } = useAuth();
  const toast = useToast();
  const isDemo = user.email === "demo@ledgerwatch.app";

  async function clearData() {
    await http.post("/api/auth/me/clear-data");
    toast("All your data has been cleared.", { type: "success" });
    // Reload so every page refetches against the now-empty ledger.
    setTimeout(() => window.location.assign("/app"), 700);
  }

  async function deleteAccount() {
    await http.delete("/api/auth/me");
    toast("Your account has been deleted.", { type: "success" });
    setTimeout(logout, 700);
  }

  return (
    <div className="stack">
      <div className="settings-head">
        <h2 className="section-title">Danger zone</h2>
        <p className="muted small">These actions cannot be undone.</p>
      </div>

      <p className="settings-note danger">
        <TriangleAlert size={15} />
        Removing a wallet from this device is separate — do that from the Wallet page, and make
        sure your recovery phrase is backed up first.
      </p>

      <div className="danger-zone">
        <DangerAction
          title="Clear all my data"
          body="Deletes every invoice, payment, reminder, watch and alert on your account. Your login, profile and payout details are kept, and your simulated portfolio resets."
          phrase="CLEAR"
          confirmLabel="Clear my data"
          onConfirm={clearData}
        />

        <DangerAction
          title="Delete my account"
          body={
            isDemo
              ? "The shared demo account is protected so it keeps working for testing, and cannot be deleted."
              : "Permanently deletes your account and everything in it. You will be signed out immediately."
          }
          phrase="DELETE"
          confirmLabel="Delete account"
          disabled={isDemo}
          onConfirm={deleteAccount}
        />
      </div>
    </div>
  );
}
