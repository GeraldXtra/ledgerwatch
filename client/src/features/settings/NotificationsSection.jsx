import { useEffect, useState } from "react";
import { BellOff, BellRing, Send } from "lucide-react";
import { Button, useToast } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import {
  disablePush,
  enablePush,
  getPushState,
  sendTestNotification,
} from "../../api/push";

const CATEGORIES = [
  {
    key: "marketAlerts",
    title: "Market alerts",
    body: "When a watch condition hits and the agent has a recommendation for you.",
  },
  {
    key: "remindersDue",
    title: "Reminders due",
    body: "When an invoice reminder is ready to send to a client.",
  },
  {
    key: "txUpdates",
    title: "Transaction updates",
    body: "When a wallet transaction confirms or fails.",
  },
];

export default function NotificationsSection() {
  const { user, updateProfile } = useAuth();
  const toast = useToast();

  const as = user.autoSend || {};
  const [autoSend, setAutoSend] = useState({
    enabled: Boolean(as.enabled),
    whatsapp: Boolean(as.whatsapp),
    email: Boolean(as.email),
  });
  const np = user.notifyPrefs || {};
  const [prefs, setPrefs] = useState({
    marketAlerts: np.marketAlerts !== false,
    remindersDue: np.remindersDue !== false,
    txUpdates: np.txUpdates !== false,
  });

  const [push, setPush] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  const refresh = () => getPushState().then(setPush);
  useEffect(() => {
    refresh();
  }, []);

  const toggleSend = (k) => (e) => setAutoSend((a) => ({ ...a, [k]: e.target.checked }));

  async function savePrefs(next) {
    setPrefs(next);
    try {
      await updateProfile({ notifyPrefs: next });
    } catch {
      toast("Could not save that preference.", { type: "error" });
    }
  }

  async function saveSending(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await updateProfile({ autoSend });
      toast("Reminder settings saved.", { type: "success" });
    } catch (err) {
      setError(err?.response?.data?.error || "Could not save settings");
    } finally {
      setBusy(false);
    }
  }

  async function enable() {
    setBusy(true);
    setMsg("");
    try {
      const res = await enablePush();
      setMsg(
        res.ok
          ? "Notifications enabled on this device."
          : res.reason === "denied"
          ? "Notifications are blocked in your browser settings — in-app alerts still work."
          : res.reason === "not-configured"
          ? "Push is not configured on the server. In-app alerts still work."
          : "Could not enable notifications. In-app alerts still work."
      );
    } finally {
      setBusy(false);
      refresh();
    }
  }

  async function disable() {
    setBusy(true);
    setMsg("");
    try {
      await disablePush();
      setMsg("Notifications turned off on this device.");
    } finally {
      setBusy(false);
      refresh();
    }
  }

  async function test() {
    setBusy(true);
    setMsg("");
    try {
      await sendTestNotification();
      setMsg("Test sent. Switch to another window — it appears when this tab is not focused.");
    } catch (err) {
      setMsg(err?.response?.data?.error || "Could not send a test notification.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="settings-head">
        <h2 className="section-title">Notifications</h2>
        <p className="muted small">
          How LedgerWatch reaches you, and how reminders reach your clients.
        </p>
      </div>

      {/* ---- Device notifications ---- */}
      <div className="settings-section">
        <div className="overline">On this device</div>

        {push && !push.supported ? (
          <p className="muted small" style={{ marginTop: 8 }}>
            This browser does not support push notifications. In-app alerts still work
            everywhere.
          </p>
        ) : push && !push.configured ? (
          <p className="muted small" style={{ marginTop: 8 }}>
            Push is not configured on the server. In-app alerts still work everywhere.
          </p>
        ) : (
          <>
            <p className="muted small" style={{ margin: "4px 0 12px" }}>
              Get alerts in your operating system's notification area even when this tab is in
              the background. While this tab is focused you will get an in-app toast instead, so
              you are never notified twice.
            </p>
            <div className="row wrap">
              {push && push.subscribed ? (
                <Button disabled={busy} onClick={disable}>
                  <BellOff size={14} /> Turn off notifications
                </Button>
              ) : (
                <Button variant="primary" disabled={busy} onClick={enable}>
                  <BellRing size={14} /> Enable notifications
                </Button>
              )}
              {push && push.subscribed && (
                <Button disabled={busy} onClick={test}>
                  <Send size={14} /> Send test notification
                </Button>
              )}
            </div>
          </>
        )}

        {msg && (
          <p className="muted small" style={{ marginTop: 10 }}>
            {msg}
          </p>
        )}

        {push && push.subscribed && (
          <div style={{ marginTop: 16 }}>
            <div className="overline">Notify me about</div>
            {CATEGORIES.map((c) => (
              <label key={c.key} className="toggle-row">
                <input
                  type="checkbox"
                  checked={prefs[c.key]}
                  onChange={(e) => savePrefs({ ...prefs, [c.key]: e.target.checked })}
                />
                <span>
                  <span className="toggle-title">{c.title}</span>
                  <span className="muted small">{c.body}</span>
                </span>
              </label>
            ))}
          </div>
        )}

        <p className="settings-note">
          Desktop notifications need the browser running — it can be minimised, but not fully
          quit. On Android install the app first; on iOS 16.4+ add it to your home screen.
        </p>
      </div>

      {/* ---- Automatic reminder sending (unchanged behaviour) ---- */}
      <form className="settings-section stack" onSubmit={saveSending}>
        <div>
          <div className="overline">Automatic reminders</div>
          <p className="muted small" style={{ margin: "4px 0 12px" }}>
            When on, LedgerWatch sends due reminders for you through the channels you pick. Off
            by default — you stay in control.
          </p>
        </div>

        <label className="toggle-row">
          <input type="checkbox" checked={autoSend.enabled} onChange={toggleSend("enabled")} />
          <span>
            <span className="toggle-title">Send reminders automatically</span>
            <span className="muted small">
              Otherwise reminders are drafted and you send them yourself.
            </span>
          </span>
        </label>
        <label className={`toggle-row${autoSend.enabled ? "" : " is-disabled"}`}>
          <input
            type="checkbox"
            checked={autoSend.whatsapp}
            onChange={toggleSend("whatsapp")}
            disabled={!autoSend.enabled}
          />
          <span>
            <span className="toggle-title">WhatsApp</span>
            <span className="muted small">Requires a Twilio number configured on the server.</span>
          </span>
        </label>
        <label className={`toggle-row${autoSend.enabled ? "" : " is-disabled"}`}>
          <input
            type="checkbox"
            checked={autoSend.email}
            onChange={toggleSend("email")}
            disabled={!autoSend.enabled}
          />
          <span>
            <span className="toggle-title">Email</span>
            <span className="muted small">
              Only clients with an email address on file are contacted.
            </span>
          </span>
        </label>

        {error && <p className="error-text">{error}</p>}
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <Button variant="primary" type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save reminder settings"}
          </Button>
        </div>
      </form>
    </div>
  );
}
