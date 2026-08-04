import { useEffect, useState } from "react";
import { BellOff, BellRing, Send, TriangleAlert } from "lucide-react";
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
      // Every branch says something specific. This used to have no catch at all,
      // so a throw anywhere in enablePush left the button silently doing nothing
      // and made a broken pipeline look like an unresponsive click.
      setMsg(
        res.ok
          ? "Notifications enabled on this device. Send a test below to confirm."
          : res.reason === "denied"
          ? "Your browser has blocked notifications for this site. See how to re-enable them below."
          : res.reason === "dismissed"
          ? "The permission prompt was closed without choosing. Press enable again to retry."
          : res.reason === "not-configured"
          ? `Push is not configured on the server. ${res.detail || ""}`.trim()
          : res.reason === "unsupported"
          ? res.detail || "This browser cannot receive push notifications."
          : `Could not enable notifications. ${res.detail || ""} In-app alerts still work.`.trim()
      );
    } catch (err) {
      setMsg(
        `Could not enable notifications: ${
          err?.response?.data?.error || err.message || "unexpected error"
        }. In-app alerts still work.`
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

        {/* The permission value, stated plainly. Without it "nothing happens when
            I press enable" is indistinguishable from "the browser blocked this
            months ago", and the API cannot re-prompt once denied. */}
        {push && push.supported && (
          <div className="row space-between perm-row">
            <span className="muted small">Browser permission</span>
            <span
              className={`pill ${
                push.permission === "granted"
                  ? "paid"
                  : push.permission === "denied"
                  ? "overdue"
                  : "pending"
              }`}
            >
              {push.permission === "granted"
                ? "Granted"
                : push.permission === "denied"
                ? "Blocked"
                : "Not asked yet"}
            </span>
          </div>
        )}

        {push && push.permission === "denied" && (
          <div className="against-note" style={{ marginTop: 10 }}>
            <TriangleAlert size={15} />
            <span>
              Chrome will not ask again once blocked, so this has to be changed by hand: click the
              icon at the left of the address bar, choose <strong>Site settings</strong>, set{" "}
              <strong>Notifications</strong> to <strong>Allow</strong>, then reload this page and
              press enable again.
            </span>
          </div>
        )}

        {push && !push.supported ? (
          <p className="muted small" style={{ marginTop: 8 }}>
            {push.reason ||
              "This browser does not support push notifications. In-app alerts still work everywhere."}
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
