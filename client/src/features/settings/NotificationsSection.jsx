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
  const [pushError, setPushError] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  /**
   * The push state had NO failure handling at all: the rejection went nowhere,
   * `push` stayed null, and the render falls through to the "Enable
   * notifications" button for a null — so somebody who already has notifications
   * on was shown the enable button, and the per-category toggles (which only
   * appear when the state says subscribed) vanished. A failed load stating a
   * definite fact about the world is the LW-029 pattern; it now says it could
   * not look, and offers to look again.
   */
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

  /**
   * OPTIMISTIC, WITH THE ROLLBACK THAT MAKES IT HONEST.
   *
   * The checkbox was flipped first and left flipped when the save failed, so
   * somebody who unticked "Market alerts" during a network blip saw it unticked,
   * believed it was off, and kept receiving market alerts — a control showing a
   * state it does not have. ARCHITECTURE §9.2 allows optimistic state and makes
   * rollback on failure mandatory; this is the smallest possible version of the
   * project's stated failure mode.
   */
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
      /**
       * READ THE ANSWER. `disablePush` was changed to report each half of the
       * work honestly ({ok, reason, detail}) instead of always returning ok —
       * but this call discarded it, so the screen could still say notifications
       * were off while the subscription survived on the server and reminders
       * kept arriving. Reporting a failure nobody renders is the same silence,
       * one level up.
       */
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
      setMsg("Test sent. Switch to another window. It appears when this tab is not focused.");
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
          Desktop notifications need the browser running. It can be minimised, but not fully
          quit. On Android install the app first; on iOS 16.4+ add it to your home screen.
        </p>
      </div>

      {/* ---- Automatic reminder sending (unchanged behaviour) ---- */}
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

        {/* Said plainly, because a reminder silently sitting in a spam folder
            looks identical to one that was never sent, and the user would
            reasonably blame the app rather than their DNS. */}
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
