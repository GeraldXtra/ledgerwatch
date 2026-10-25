import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { CheckCircle2, MailX } from "lucide-react";
import http from "../api/http";
import PublicShell from "../components/PublicShell";
import usePageMeta from "../components/usePageMeta";
import { Button, Card, SkeletonLines } from "../components/ui";

export default function UnsubscribePage() {
  const { token } = useParams();
  const [info, setInfo] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  usePageMeta({ title: "Email preferences · LedgerWatch", noindex: true });

  useEffect(() => {
    let active = true;
    http
      .get(`/api/public/unsubscribe/${encodeURIComponent(token)}`)
      .then(({ data }) => active && setInfo(data))
      .catch((err) => {
        if (active) setError(err?.response?.data?.error || "Your email preferences could not be loaded just now.");
      });
    return () => {
      active = false;
    };
  }, [token]);

  async function choose(action) {
    setBusy(true);
    setError("");
    try {
      const { data } = await http.post(`/api/public/unsubscribe/${encodeURIComponent(token)}`, { action });
      setInfo(data);
    } catch (err) {
      setError(err?.response?.data?.error || "Your choice could not be saved just now. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  const debtor = info && info.kind === "debtor";
  const what = debtor
    ? `payment reminder emails from ${info.businessName}`
    : "LedgerWatch activity emails for your account";

  return (
    <PublicShell bare>
      <div className="pay-page stack">
        {!info && !error ? (
          <Card>
            <SkeletonLines count={3} />
          </Card>
        ) : !info ? (
          <Card title="This link does not work any more">
            <p className="muted">{error}</p>
          </Card>
        ) : (
          <Card title={info.unsubscribed ? "You are unsubscribed" : `Stop ${what}`}>
            <div className="stack-sm">
              {info.unsubscribed ? (
                <p className="row tight">
                  <CheckCircle2 size={16} /> You will not receive {what}
                  {debtor && info.email ? ` at ${info.email}` : ""}.
                </p>
              ) : (
                <p className="row tight">
                  <MailX size={16} /> Press the button to stop {what}
                  {debtor && info.email ? ` at ${info.email}` : ""}.
                </p>
              )}
              {debtor && (
                <p className="muted small">
                  Receipts for payments you make are still sent, so you always have a record. {info.businessName} can
                  still reach you on WhatsApp or by phone.
                </p>
              )}
              {!debtor && (
                <p className="muted small">
                  Notifications on your devices are not affected. You can change every email and notification in
                  Settings, Notifications.
                </p>
              )}
              <div className="row wrap">
                {info.unsubscribed ? (
                  <Button onClick={() => choose("resubscribe")} disabled={busy}>
                    I changed my mind, send them again
                  </Button>
                ) : (
                  <Button variant="primary" onClick={() => choose("unsubscribe")} disabled={busy}>
                    Unsubscribe
                  </Button>
                )}
              </div>
              {error && <p className="error-text">{error}</p>}
            </div>
          </Card>
        )}
      </div>
    </PublicShell>
  );
}
