/**
 * Paid-vs-outstanding progress bar. `paid` and `total` in the same currency.
 * Full (paid>=total) renders green (paid); partial renders the gold accent.
 */
export default function ProgressBar({ paid, total, showLabel = false, size = "md" }) {
  const t = Number(total) || 0;
  const p = Math.max(0, Math.min(t, Number(paid) || 0));
  const share = t > 0 ? (p / t) * 100 : 0;
  const full = t > 0 && p >= t;

  return (
    <div className={`progress-wrap ${size === "sm" ? "progress-sm" : ""}`.trim()}>
      <div className="progress-track" role="progressbar" aria-valuenow={Math.round(share)} aria-valuemin={0} aria-valuemax={100}>
        <span className={`progress-fill ${full ? "full" : ""}`} style={{ width: `${share}%` }} />
      </div>
      {showLabel && (
        <span className="progress-label num">{Math.round(share)}%</span>
      )}
    </div>
  );
}
