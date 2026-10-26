import { useEffect, useState } from "react";
import { CircleCheck, TriangleAlert } from "lucide-react";
import http from "../../api/http";
import { channelStatusLines } from "./reminderDelivery";

export default function ReminderChannels({ wantEmail, wantWhatsapp }) {
  const [channels, setChannels] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    http
      .get("/api/automation/status")
      .then(({ data }) => {
        if (!active) return;
        setChannels((data && data.reminderChannels) || null);
        setError(data && data.reminderChannels ? "" : "the server did not say");
      })
      .catch((err) => {
        if (active) setError(err?.response?.data?.error || err.message || "the server did not answer");
      });
    return () => {
      active = false;
    };
  }, []);

  if (error) {
    return (
      <p className="settings-note">
        <TriangleAlert size={15} />
        Whether this server can send reminders by itself could not be checked: {error}.
      </p>
    );
  }
  if (!channels) return null;

  const lines = channelStatusLines(channels, { wantEmail, wantWhatsapp });
  if (!lines.length) return null;

  return (
    <div className="stack-sm">
      {lines.map((line) => (
        <p key={line.channel} className={line.ok ? "muted small" : "settings-note"} style={line.ok ? { margin: 0 } : undefined}>
          {line.ok ? <CircleCheck size={13} /> : <TriangleAlert size={15} />} {line.text}
        </p>
      ))}
    </div>
  );
}
