import { useEffect, useState } from "react";
import { Mail, MessageCircle, Send, TriangleAlert, X } from "lucide-react";
import http from "../../api/http";
import { Button, Modal, PageHeader, SkeletonLines, StatusPill, useToast } from "../../components/ui";
import { channelName, deliveryNotes } from "./reminderDelivery";

function formatDateTime(value) {
  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value);
  return d.toLocaleString();
}

const DELIVERY_LABEL = {
  sent: "Sent",
  failed: "Failed",
  skipped: "Skipped",
  queued: "Queued",
};

function DeliveryChip({ delivery }) {
  const status = delivery.status || "queued";
  const channel = channelName(delivery.channel);
  const title = delivery.error || (delivery.providerId ? `Provider ref: ${delivery.providerId}` : "");
  return (
    <span className={`delivery-chip delivery-${status}`} title={title}>
      {delivery.channel === "email" ? <Mail size={12} /> : <MessageCircle size={12} />}
      {channel} · {DELIVERY_LABEL[status] || status}
    </span>
  );
}

export default function ReminderPanel({ debt, result, onClose, inline = false }) {
  const toast = useToast();
  const [reminders, setReminders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(null);
  const [logError, setLogError] = useState("");

  const hasEmail = Boolean(debt.debtorEmail);
  const emailUndeliverable =
    hasEmail && /@([^@]*\.)?(example|test|invalid|localhost)(\.[a-z]{2,})?$/i.test(debt.debtorEmail);

  const LOG_LOAD_FAILED =
    "The reminder history could not be loaded, so what is shown below may be incomplete. This is a connection problem, not a statement that no reminder has been sent.";

  async function loadReminders() {
    setLoading(true);
    try {
      const { data } = await http.get(`/api/debts/${debt._id}/reminders`);
      setReminders(data.reminders);
      setLogError("");
    } catch (err) {
      setLogError(err?.response?.data?.error || LOG_LOAD_FAILED);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const { data } = await http.get(`/api/debts/${debt._id}/reminders`);
        if (active) {
          setReminders(data.reminders);
          setLogError("");
        }
      } catch (err) {
        if (active) setLogError(err?.response?.data?.error || LOG_LOAD_FAILED);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [debt._id, result]);

  async function send(channels, label) {
    setSending(label);
    try {
      const { data } = await http.post(`/api/debts/${debt._id}/send`, { channels });
      const deliveries = data.deliveries || [];
      const sent = deliveries.filter((d) => d.status === "sent");
      const skipped = deliveries.filter((d) => d.status === "skipped");
      const failed = deliveries.filter((d) => d.status === "failed");
      const queued = deliveries.filter((d) => d.status === "queued");

      if (sent.length) {
        toast(`Sent via ${sent.map((d) => d.channel).join(" & ")}.`, { type: "success" });
      }
      sent
        .filter((d) => d.warning)
        .forEach((d) => toast(d.warning, { type: "error", duration: 9000 }));

      if (failed.length) {
        failed.forEach((d) =>
          toast(`${d.channel}: ${d.error || "could not be sent"}`, { type: "error", duration: 9000 })
        );
      }
      skipped.forEach((d) =>
        toast(`${channelName(d.channel)} not sent: ${d.error || "it was skipped"}`, { type: "info", duration: 9000 })
      );
      queued.forEach((d) =>
        toast(`${channelName(d.channel)} not sent yet: ${d.error || "it is waiting to be sent"}`, {
          type: "info",
          duration: 9000,
        })
      );
      await loadReminders();
    } catch (err) {
      const served = err?.response?.data?.error;
      toast(
        served ||
          (err?.code === "ECONNABORTED"
            ? "The request timed out before the server answered. The reminder may still have gone out. Check the history below before resending."
            : "Could not reach the server. Check that it is running, then try again."),
        { type: "error", duration: 9000 }
      );
    } finally {
      setSending(null);
    }
  }

  const closeButton = (
    <Button variant="ghost" icon title="Close" onClick={onClose}>
      <X size={15} />
    </Button>
  );

  const content = (
    <>
      {result && (
        <section className="card">
          {inline && (
            <div className="card-head">
              <div className="card-head-main">
                <h3 className="card-title">Reminder for {debt.debtorName}</h3>
              </div>
              {closeButton}
            </div>
          )}
          <div className="stack">
          <div className="reminder-box">{result.messageText}</div>
          <div className="row wrap">
            <Button
              variant="secondary"
              loading={sending === "whatsapp"}
              disabled={Boolean(sending) || !result.phoneValid}
              title={result.phoneValid ? "Send via WhatsApp provider" : "No valid phone number on file"}
              onClick={() => send(["whatsapp"], "whatsapp")}
            >
              <MessageCircle size={14} /> Send WhatsApp
            </Button>
            <Button
              variant="secondary"
              loading={sending === "email"}
              disabled={Boolean(sending) || !hasEmail}
              title={hasEmail ? "Send via email" : "No email address on file"}
              onClick={() => send(["email"], "email")}
            >
              <Mail size={14} /> Send Email
            </Button>
            <Button
              variant="secondary"
              loading={sending === "both"}
              disabled={Boolean(sending) || !result.phoneValid || !hasEmail}
              title={
                !result.phoneValid
                  ? "No valid phone number on file"
                  : !hasEmail
                  ? "No email address on file"
                  : "Send via WhatsApp and email"
              }
              onClick={() => send(["whatsapp", "email"], "both")}
            >
              <Send size={14} /> Send Both
            </Button>
          </div>

          <div className="row wrap">
            {result.waLink ? (
              <Button
                variant="ghost"
                href={result.waLink}
                target="_blank"
                rel="noopener noreferrer"
              >
                <MessageCircle size={14} /> Open in WhatsApp
              </Button>
            ) : null}
            <span className="muted small">
              {result.source === "ai" ? "AI-drafted" : "Template"}
              {result.bankDetailsMissing ? " · payout details not set" : ""}
              {!result.phoneValid ? " · phone missing or invalid" : ""}
              {!hasEmail ? " · no email on file" : ""}
            </span>
          </div>

          {emailUndeliverable && (
            <div className="against-note">
              <TriangleAlert size={15} />
              <span>
                <strong>{debt.debtorEmail}</strong> uses a reserved domain, so mail to it is
                accepted and then bounced. It will report as sent and never arrive. Put a real
                address on this client before relying on email.
              </span>
            </div>
          )}
          </div>
        </section>
      )}

      <section className="card">
        <div className="card-head">
          <div className="card-head-main">
            <h3 className="card-title">Reminder log</h3>
          </div>
        </div>
        {logError && <p className="error-text">{logError}</p>}
        {loading ? (
          <div className="mt">
            <SkeletonLines count={2} />
          </div>
        ) : reminders.length === 0 && logError ? null : reminders.length === 0 ? (
          <p className="muted small">No reminders generated yet.</p>
        ) : (
          <ul className="log">
            {reminders.map((r) => (
              <li key={r._id} className="log-row">
                <div className="row wrap tight">
                  <StatusPill status={r.status} />
                  <span className="muted small num">{formatDateTime(r.createdAt)}</span>
                </div>
                {r.deliveries && r.deliveries.length > 0 && (
                  <div className="delivery-row">
                    {r.deliveries.map((d, i) => (
                      <DeliveryChip key={i} delivery={d} />
                    ))}
                  </div>
                )}
                {deliveryNotes(r.deliveries).map((note, i) => (
                  <p key={`note-${i}`} className="muted small" style={{ margin: 0 }}>
                    {note}
                  </p>
                ))}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );

  if (inline) return content;

  return (
    <Modal
      label={`Reminder for ${debt.debtorName}`}
      view="reminder"
      crumb={`Reminder for ${debt.debtorName}`}
      onClose={onClose}
    >
      <PageHeader title={<>Reminder for {debt.debtorName}</>} action={closeButton} />
      {content}
    </Modal>
  );
}
