import { useEffect, useState } from "react";
import { Mail, MessageCircle, Send, TriangleAlert, X } from "lucide-react";
import http from "../../api/http";
import { Button, Modal, SkeletonLines, StatusPill, useToast } from "../../components/ui";

function formatDateTime(value) {
  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value);
  return d.toLocaleString();
}

// Human copy for a per-channel delivery status.
const DELIVERY_LABEL = {
  sent: "Sent",
  failed: "Failed",
  skipped: "Skipped",
  queued: "Queued",
};

function DeliveryChip({ delivery }) {
  const status = delivery.status || "queued";
  const channel = delivery.channel === "email" ? "Email" : "WhatsApp";
  const title = delivery.error || (delivery.providerId ? `Provider ref: ${delivery.providerId}` : "");
  return (
    <span className={`delivery-chip delivery-${status}`} title={title}>
      {delivery.channel === "email" ? <Mail size={12} /> : <MessageCircle size={12} />}
      {channel} · {DELIVERY_LABEL[status] || status}
    </span>
  );
}

/**
 * Reminder modal for a single debt: the freshly generated message, provider send
 * actions (WhatsApp / Email / Both) plus the always-available wa.me link, and the
 * reminder log with per-channel delivery records.
 * `result` is the response from POST /remind. `debt` is the target debt.
 */
export default function ReminderPanel({ debt, result, onClose }) {
  const toast = useToast();
  const [reminders, setReminders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(null); // which channel-set is in flight
  /**
   * A FAILED LOAD USED TO CLAIM THERE IS NO HISTORY (LW-029).
   *
   * Both loaders below emptied the list on a failure, and an empty list renders
   * "No reminders generated yet." — a statement about this invoice, produced by
   * a dropped connection. The owner then resends a reminder they have already
   * sent today. The list is left alone now and the failure is reported.
   */
  const [logError, setLogError] = useState("");

  const hasEmail = Boolean(debt.debtorEmail);
  /**
   * Reserved, non-routable domains (RFC 2606 / RFC 6761). Mail to these is
   * accepted at the SMTP handshake and bounced afterwards, so it records as
   * "sent" while never arriving — the worst of both outcomes. Mirrors the same
   * check on the server.
   */
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
    // reload when a new reminder was generated (result changes)
  }, [debt._id, result]);

  // POST /send — dispatch via the configured providers. Degrades gracefully:
  // an unconfigured provider comes back "skipped", surfaced as an info toast.
  async function send(channels, label) {
    setSending(label);
    try {
      const { data } = await http.post(`/api/debts/${debt._id}/send`, { channels });
      const deliveries = data.deliveries || [];
      const sent = deliveries.filter((d) => d.status === "sent");
      const skipped = deliveries.filter((d) => d.status === "skipped");
      const failed = deliveries.filter((d) => d.status === "failed");

      if (sent.length) {
        toast(`Sent via ${sent.map((d) => d.channel).join(" & ")}.`, { type: "success" });
      }
      // Accepted by the mail server but it will not arrive — a reserved recipient
      // domain, typically. Reported separately from success, because it looks
      // exactly like success otherwise.
      sent
        .filter((d) => d.warning)
        .forEach((d) => toast(d.warning, { type: "error", duration: 9000 }));

      if (failed.length) {
        failed.forEach((d) =>
          toast(`${d.channel}: ${d.error || "could not be sent"}`, { type: "error", duration: 9000 })
        );
      }
      if (!sent.length && !failed.length && skipped.length) {
        toast(
          `Not configured on the server. ${skipped
            .map((d) => d.channel)
            .join(" & ")} skipped. Use "Open in WhatsApp" to send by hand.`,
          { type: "info" }
        );
      }
      await loadReminders();
    } catch (err) {
      // No server response at all means the request never completed: a timeout,
      // a dropped connection, or the server restarting mid-send. Say which,
      // rather than the bare "Send failed" that explained nothing.
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

  return (
    <Modal label={`Reminder for ${debt.debtorName}`} onClose={onClose}>
      <div className="row space-between">
        <h3 className="section-title">Reminder for {debt.debtorName}</h3>
        <Button variant="ghost" icon title="Close" onClick={onClose}>
          <X size={15} />
        </Button>
      </div>

      {result && (
        <>
          <div className="reminder-box">{result.messageText}</div>

          <div className="row wrap">
            <Button
              variant="primary"
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

          {/* Said BEFORE sending, not after. A reserved domain is accepted by the
              mail server and bounced later, so the send reports success and the
              client never hears from you. */}
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
        </>
      )}

      <div>
        <div className="overline">Reminder log</div>
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
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
