/**
 * Shimmer placeholders. `SkeletonLines` renders n text lines;
 * `SkeletonBlock` a taller block (stat cards, chart areas).
 */
export function SkeletonLines({ count = 3 }) {
  return (
    <div className="stack-sm" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="skeleton sk-line"
          style={{ width: `${100 - i * 12}%` }}
        />
      ))}
    </div>
  );
}

export function SkeletonBlock({ height = 56 }) {
  return <div className="skeleton sk-block" style={{ height }} aria-hidden="true" />;
}
