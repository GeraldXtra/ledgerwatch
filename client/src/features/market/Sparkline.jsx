/**
 * Tiny inline-SVG sparkline (hand-rolled polyline — light enough for many rows).
 * Colored by direction: emerald if the series ends up, muted red if down.
 * `data` is an array of numbers (e.g. the 7d price series).
 */
export default function Sparkline({ data, width = 96, height = 28 }) {
  if (!data || data.length < 2) {
    return <span className="sparkline-empty" style={{ width, height }} aria-hidden="true" />;
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const stepX = width / (data.length - 1);
  const pad = 2;
  const h = height - pad * 2;

  const points = data
    .map((v, i) => {
      const x = i * stepX;
      const y = pad + h - ((v - min) / range) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const up = data[data.length - 1] >= data[0];
  const stroke = up ? "var(--pos-text)" : "var(--neg-text)";

  return (
    <svg
      className="sparkline"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polyline
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
