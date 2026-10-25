import { useEffect, useState } from "react";
import { Copy, Download, KeyRound, ShieldCheck } from "lucide-react";
import http from "../../api/http";
import { useAuth } from "../../context/AuthContext";
import { Button, Field, Input, useToast } from "../../components/ui";

function grouped(secret) {
  return String(secret || "").replace(/(.{4})/g, "$1 ").trim();
}

function BackupCodes({ codes, onDone }) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const text = ["LedgerWatch backup codes", "Each code works once.", "", ...codes].join("\n");

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopyFailed(false);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopyFailed(true);
    }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "ledgerwatch-backup-codes.txt";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  return (
    <div className="stack-sm">
      <p className="settings-note danger">
        <KeyRound size={15} />
        Save these ten backup codes somewhere safe, away from your phone. If you lose your phone, each one signs you in
        once. They will not be shown again.
      </p>
      <ul className="backup-codes num">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="row wrap">
        <Button size="sm" onClick={copy}>
          <Copy size={14} /> {copied ? "Copied" : "Copy all"}
        </Button>
        <Button size="sm" onClick={download}>
          <Download size={14} /> Download as a text file
        </Button>
        <Button size="sm" variant="primary" onClick={onDone}>
          I have saved them
        </Button>
      </div>
      {copyFailed && <p className="error-text">Your browser blocked copying. Download them instead.</p>}
    </div>
  );
}

export default function TwoFactorCard() {
  const { user, applyUser } = useAuth();
  const toast = useToast();
  const [status, setStatus] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [step, setStep] = useState("idle");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [setup, setSetup] = useState(null);
  const [codes, setCodes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    try {
      const { data } = await http.get("/api/auth/me/2fa");
      setStatus(data);
      setLoadError("");
    } catch (err) {
      setLoadError(err?.response?.data?.error || "Whether two-step sign-in is on could not be checked just now.");
    }
  }

  useEffect(() => {
    load();
  }, []);

  function reset(nextStep = "idle") {
    setStep(nextStep);
    setPassword("");
    setCode("");
    setError("");
  }

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

  const startSetup = (e) =>
    run(async () => {
      e.preventDefault();
      const { data } = await http.post("/api/auth/me/2fa/setup", { password });
      setSetup(data);
      reset("confirm");
    });

  const enable = (e) =>
    run(async () => {
      e.preventDefault();
      const { data } = await http.post("/api/auth/me/2fa/enable", { code });
      if (data.user && applyUser) applyUser(data.user);
      setSetup(null);
      setCodes(data.backupCodes);
      reset("codes");
      await load();
    });

  const disable = (e) =>
    run(async () => {
      e.preventDefault();
      const { data } = await http.post("/api/auth/me/2fa/disable", { password, code });
      if (data.user && applyUser) applyUser(data.user);
      reset("idle");
      toast("Two-step sign-in is off.", { type: "info" });
      await load();
    });

  const renewCodes = (e) =>
    run(async () => {
      e.preventDefault();
      const { data } = await http.post("/api/auth/me/2fa/backup-codes", { code });
      setCodes(data.backupCodes);
      reset("codes");
      await load();
    });

  const enabled = status ? status.enabled : Boolean(user?.twoFactorEnabled);

  return (
    <div className="stack-sm">
      <div className="settings-head">
        <h3 className="card-title">Two-step sign-in</h3>
        <p className="muted small">
          Ask for a code from an authenticator app, such as Google Authenticator or Microsoft Authenticator, every time
          you sign in. Someone who learns your password still cannot get in.
        </p>
      </div>

      {loadError && <p className="error-text">{loadError}</p>}

      {step === "codes" && codes && (
        <BackupCodes
          codes={codes}
          onDone={() => {
            setCodes(null);
            reset("idle");
            toast("Two-step sign-in is ready.", { type: "success" });
          }}
        />
      )}

      {step === "idle" && status && !enabled && (
        <div className="row wrap">
          <Button variant="primary" onClick={() => reset("password")}>
            <ShieldCheck size={14} /> Set up two-step sign-in
          </Button>
        </div>
      )}

      {step === "idle" && status && enabled && (
        <div className="stack-sm">
          <p className="row tight">
            <ShieldCheck size={16} /> On. {status.backupCodesLeft} backup code{status.backupCodesLeft === 1 ? "" : "s"} left.
          </p>
          <div className="row wrap">
            <Button onClick={() => reset("renew")}>Make new backup codes</Button>
            <Button variant="danger" onClick={() => reset("disable")}>
              Turn it off
            </Button>
          </div>
        </div>
      )}

      {step === "password" && (
        <form className="stack-sm" onSubmit={startSetup}>
          <Field label="Your LedgerWatch password">
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </Field>
          {user?.authProvider === "google" && (
            <p className="muted small">
              If you sign in with Google and have never set a password, set one first with Forgot password on the sign
              in page.
            </p>
          )}
          <div className="row wrap">
            <Button variant="primary" type="submit" disabled={busy}>
              Continue
            </Button>
            <Button variant="ghost" type="button" onClick={() => reset("idle")}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {step === "confirm" && setup && (
        <form className="stack-sm" onSubmit={enable}>
          <p className="muted small">
            Scan this code with your authenticator app. If you cannot scan it, add an account by hand with the key
            below.
          </p>
          <img src={setup.qr} alt="QR code for your authenticator app" className="receive-qr" />
          <code className="wallet-address num">{grouped(setup.secret)}</code>
          <Field label="The six digit code your app now shows">
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              required
            />
          </Field>
          <div className="row wrap">
            <Button variant="primary" type="submit" disabled={busy}>
              Turn on two-step sign-in
            </Button>
            <Button
              variant="ghost"
              type="button"
              onClick={() => {
                setSetup(null);
                reset("idle");
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}

      {(step === "disable" || step === "renew") && (
        <form className="stack-sm" onSubmit={step === "disable" ? disable : renewCodes}>
          {step === "disable" && (
            <Field label="Your LedgerWatch password">
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
            </Field>
          )}
          <Field label="A code from your app, or a backup code">
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^a-zA-Z0-9]/g, "").slice(0, 10))}
              autoComplete="one-time-code"
              required
            />
          </Field>
          {step === "renew" && <p className="muted small">Your old backup codes stop working when the new ones are made.</p>}
          <div className="row wrap">
            <Button variant={step === "disable" ? "danger" : "primary"} type="submit" disabled={busy}>
              {step === "disable" ? "Turn off two-step sign-in" : "Make new backup codes"}
            </Button>
            <Button variant="ghost" type="button" onClick={() => reset("idle")}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
