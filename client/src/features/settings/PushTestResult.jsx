import { CircleAlert, CircleCheck, Clock } from "lucide-react";
import { receiptAdvice, renewText, resultLabel, syncFailureText, testSummary } from "./pushReport";

const TONE_ICON = { ok: CircleCheck, wait: Clock, error: CircleAlert };

export default function PushTestResult({ run, device }) {
  if (!run) return null;
  if (run.phase === "sending") {
    return (
      <p className="muted small" role="status" style={{ marginTop: 10 }}>
        Sending a test notification.
      </p>
    );
  }
  if (run.phase === "failed") {
    return (
      <p className="error-text" role="alert" style={{ marginTop: 10 }}>
        The test could not be sent: {run.error}. Nothing was delivered.
      </p>
    );
  }

  const { report, sync, renewed, receipt } = run;
  const results = (report && report.results) || [];
  const here = report && report.thisDevice;
  const note = receiptAdvice(receipt, device);
  const Icon = note ? TONE_ICON[note.tone] : null;

  return (
    <div className="stack-sm" role="status" aria-live="polite" style={{ marginTop: 10 }}>
      <p className={report.ok ? "small" : "error-text"} style={{ margin: 0 }}>
        {testSummary(report)}
      </p>
      {sync && !sync.ok && (
        <p className="error-text" style={{ margin: 0 }}>
          This device was not registered before the test. {syncFailureText(sync)}
        </p>
      )}
      {renewed && (
        <p className={renewed.ok ? "muted small" : "error-text"} style={{ margin: 0 }}>
          {renewText(renewed)}
        </p>
      )}
      {results.map((r) => (
        <div key={r.id}>
          <div className="row space-between perm-row">
            <span className="small">
              {r.device}
              {r.thisDevice ? ", this device" : ""}
            </span>
            <span className={`pill ${r.delivered ? "paid" : "overdue"}`}>{resultLabel(r)}</span>
          </div>
          {!r.delivered && r.reason && (
            <p className="muted small" style={{ margin: "2px 0 0" }}>
              {r.reason}
              {r.removed ? " It was removed from this account." : ""}
            </p>
          )}
        </div>
      ))}
      {here && here.registered === false && !renewed && (
        <p className="error-text" style={{ margin: 0 }}>
          {here.reason}
        </p>
      )}
      {note && (
        <div className={note.tone === "error" ? "against-note" : "settings-note"}>
          {Icon && <Icon size={15} />}
          <span>
            {note.text}
            {note.advice ? ` ${note.advice}` : ""}
          </span>
        </div>
      )}
    </div>
  );
}
