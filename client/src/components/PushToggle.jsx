import { useEffect, useState } from "react";
import { BellRing, BellOff } from "lucide-react";
import { Button } from "./ui";
import { getPushState, enablePush, disablePush } from "../api/push";

/**
 * Notification opt-in control. Permission is only ever requested from the button
 * click (a real user gesture), never on load. Degrades clearly when the browser
 * has no push support or the server has no VAPID keys configured.
 */
export default function PushToggle() {
  const [state, setState] = useState(null); // { supported, configured, subscribed, permission }
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function refresh() {
    setState(await getPushState());
  }

  useEffect(() => {
    refresh();
  }, []);

  async function enable() {
    setBusy(true);
    setMsg("");
    try {
      const res = await enablePush();
      if (!res.ok) {
        setMsg(
          res.reason === "denied"
            ? "Notifications are blocked in your browser settings."
            : res.reason === "not-configured"
            ? "Push is not configured on the server."
            : "Could not enable notifications."
        );
      } else {
        setMsg("Notifications enabled on this device.");
      }
    } catch {
      setMsg("Could not enable notifications.");
    } finally {
      setBusy(false);
      await refresh();
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
      await refresh();
    }
  }

  if (!state) return null;

  return (
    <div className="settings-section">
      <div className="overline">Push notifications</div>
      <p className="muted small" style={{ margin: "4px 0 12px" }}>
        Get a notification when a reminder is ready or a market alert fires — with
        one-tap actions. In-app toasts always work as a fallback.
      </p>

      {!state.supported ? (
        <p className="muted small">This browser does not support push notifications.</p>
      ) : !state.configured ? (
        <p className="muted small">
          Push is not configured on the server. Set VAPID keys to enable it.
        </p>
      ) : state.subscribed ? (
        <Button variant="secondary" onClick={disable} disabled={busy}>
          <BellOff size={14} /> Turn off notifications
        </Button>
      ) : (
        <Button variant="primary" onClick={enable} disabled={busy}>
          <BellRing size={14} /> Enable notifications
        </Button>
      )}

      {msg && (
        <p className="muted small" style={{ marginTop: 10 }}>
          {msg}
        </p>
      )}
    </div>
  );
}
