import { useEffect, useState } from "react";

/**
 * "Updated Xs ago" with a small pulsing dot. When `stale`, shows a quiet
 * "Prices delayed" note instead. `lastFetchedAt` is a client timestamp (ms).
 */
export default function LiveIndicator({ lastFetchedAt, stale }) {
  const [, force] = useState(0);

  // Re-render every 5s so "Xs ago" stays current.
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, []);

  if (stale) {
    return (
      <span className="live-indicator delayed">
        <span className="live-dot delayed" />
        Prices delayed
      </span>
    );
  }

  let label = "Live";
  if (lastFetchedAt) {
    const secs = Math.max(0, Math.round((Date.now() - lastFetchedAt) / 1000));
    label = secs < 5 ? "Updated just now" : `Updated ${secs}s ago`;
  }

  return (
    <span className="live-indicator">
      <span className="live-dot" />
      {label}
    </span>
  );
}
