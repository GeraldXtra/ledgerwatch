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
    key: "moneyIn",
    title: "Money received",
    body: "When money reaches your wallet, an invoice is paid or part paid, or a payment is detected.",
  },
  {
    key: "trades",
    title: "Trades",
    body: "When a live trade confirms or fails, and when a paper trade is filled.",
  },
  {
    key: "profit",
    title: "Profit",
    body: "When the profit agent records a profit and when it is moved to your profit balance.",
  },
  {
    key: "txUpdates",
    title: "Transaction updates",
    body: "When a transfer, approval or sweep confirms or fails.",
  },
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
];

const PREF_KEYS = [...CATEGORIES.map((c) => c.key), "emailActivity"];

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
  const [prefs, setPrefs] = useState(() =>
    Object.fromEntries(PREF_KEYS.map((k) => [k, np[k] !== false]))
  );

  const [push, setPush] = useState(null);
  const [pushError, setPushError] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  const refresh = () =>
    getPushState()
      .then((state) => {
        setPush(state);
        setPushError("");
      })
      .catch((err) => {
        setPush(null);
        setPushError(
          err?.response?.data?.error || err.message || "the browser or server did not answer"
        );
      });

  useEffect(() => {
    refresh();
  }, []);

  const toggleSend = (k) => (e) => setAutoSend((a) => ({ ...a, [k]: e.target.checked }));

  async function savePrefs(next) {
    const previous = prefs;
    setPrefs(next);
    try {
      await updateProfile({ notifyPrefs: next });
    } catch (err) {
      setPrefs(previous);
      toast(
        `That preference was not saved: ${
          err?.response?.data?.error || err.message || "the server did not answer"
        }. It is unchanged.`,
        { type: "error" }
      );
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
      const off = await disablePush();
      if (off && off.ok === false) {
        toast(
          "Notifications could not be switched off: " +
            (off.detail || off.reason || "the server did not confirm it") +
            ". This device may still receive them.",
          { type: "error", duration: 10000 }
        );
      }
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
      setMsg("Test sent. It appears in your notification area in a few seconds.");
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

      <div className="settings-section">
        <div className="overline">On this device</div>

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

        {pushError ? (
          <div className="stack-sm" style={{ marginTop: 8 }}>
            <p className="error-text" style={{ margin: 0 }}>
              Whether notifications are on for this device could not be checked: {pushError}. Your
              settings are unchanged, and in-app alerts still work.
            </p>
            <div>
              <Button size="sm" disabled={busy} onClick={refresh}>
                Try again
              </Button>
            </div>
          </div>
        ) : push && !push.supported ? (
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
              Get alerts in your operating system's notification area, even when this tab is in
              the background or closed. Enable them on each device you use; every enabled device
              receives them.
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

        <div style={{ marginTop: 16 }}>
          <div className="overline">Notify me about</div>
          <p className="muted small" style={{ margin: "4px 0 8px" }}>
            These choices apply to notifications on every device and to activity emails.
          </p>
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
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={prefs.emailActivity}
              onChange={(e) => savePrefs({ ...prefs, emailActivity: e.target.checked })}
            />
            <span>
              <span className="toggle-title">Email me about activity</span>
              <span className="muted small">
                A receipt by email for money received, trades, transfers, sweeps and profit, sent
                to {user.email}.
              </span>
            </span>
          </label>
        </div>

        <p className="settings-note">
          Desktop notifications need the browser running. It can be minimised, but not fully
          quit. On Android install the app first; on iOS 16.4+ add it to your home screen.
        </p>
      </div>

      <form className="settings-section stack" onSubmit={saveSending}>
        <div>
          <div className="overline">Automatic reminders</div>
          <p className="muted small" style={{ margin: "4px 0 12px" }}>
            When on, LedgerWatch sends due reminders for you through the channels you pick. Off
            by default, so you stay in control.
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

        {autoSend.enabled && autoSend.email && (
          <p className="muted small settings-note">
            <strong>About spam folders.</strong> Reminders sent from a personal Gmail address
            frequently land in spam, and this is not something the app can fix from its side.
            Mail providers check whether the sending domain authorised the message; a
            gmail.com sender relayed on your behalf does not match, so it is treated with
            suspicion however well the email is put together. LedgerWatch already does the
            rest, a proper plain text alternative, unsubscribe headers, light inline images
            and no tracking. Reliable inbox delivery needs a domain you own with SPF, DKIM and
            DMARC records; the README lists the exact records.
          </p>
        )}

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
