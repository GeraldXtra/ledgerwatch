import { useEffect, useState } from "react";
import { Mail, MessageCircle, Send, X } from "lucide-react";
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

  const hasEmail = Boolean(debt.debtorEmail);

  async function loadReminders() {
    setLoading(true);
    try {
      const { data } = await http.get(`/api/debts/${debt._id}/reminders`);
      setReminders(data.reminders);
    } catch {
      setReminders([]);
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
        if (active) setReminders(data.reminders);
      } catch {
        if (active) setReminders([]);
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
      if (failed.length) {
        toast(`Failed: ${failed.map((d) => `${d.channel} (${d.error || "error"})`).join(", ")}`, { type: "error" });
      }
      if (!sent.length && !failed.length && skipped.length) {
        toast(
          `Not configured on the server — ${skipped
            .map((d) => d.channel)
            .join(" & ")} skipped. Use "Open in WhatsApp" to send by hand.`,
          { type: "info" }
        );
      }
      await loadReminders();
    } catch (err) {
      toast(err?.response?.data?.error || "Send failed", { type: "error" });
    } finally {
      setSending(null);
    }
  }

  return (
    <Modal label={`Reminder for ${debt.debtorName}`} onClose={onClose}>
      <div className="row space-between">
        <h3 className="section-title">Reminder — {debt.debtorName}</h3>
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
        </>
      )}

      <div>
        <div className="overline">Reminder log</div>
        {loading ? (
          <div className="mt">
            <SkeletonLines count={2} />
          </div>
        ) : reminders.length === 0 ? (
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
