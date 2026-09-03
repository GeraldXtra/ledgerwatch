import {
  Bar,
  BarChart,
  Cell,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { compactNgn, ngn } from "./format";

const reduceMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Single-hue NAVY intensity ramp: deeper navy = older money, so age reads as
// weight. The previous ramp mixed a green bucket with four golds — two clashing
// hues whose pale end vanished against the white card. The steps are theme
// tokens: on light paper the ramp darkens toward the accent, on dark paper it
// brightens, because "heavier" has to mean "more contrast" on both.
const BUCKETS = [
  { key: "current", label: "Current", color: "var(--chart-ramp-1)" },
  { key: "d1_30", label: "1 to 30 days", color: "var(--chart-ramp-2)" },
  { key: "d31_60", label: "31 to 60 days", color: "var(--chart-ramp-3)" },
  { key: "d61_90", label: "61 to 90 days", color: "var(--chart-ramp-4)" },
  { key: "d90plus", label: "90d+", color: "var(--chart-ramp-5)" },
];

function ChartTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const p = payload[0].payload;
  return (
    <div className="chart-tooltip">
      <div className="overline">{p.label}</div>
      <div className="num mono-strong">{ngn(p.value)}</div>
    </div>
  );
}

/**
 * Aging breakdown of outstanding money. `aging` = { current, d1_30, d31_60, d61_90, d90plus }.
 */
export default function AgingChart({ aging }) {
  const data = BUCKETS.map((b) => ({ label: b.label, value: aging[b.key] || 0, color: b.color }));
  const empty = data.every((d) => d.value === 0);

  return (
    <div className="rec-chart-frame">
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} margin={{ top: 10, right: 8, bottom: 0, left: 8 }} barCategoryGap="12%">
          <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
          <XAxis dataKey="label" tick={{ fill: "var(--chart-tick)", fontSize: 11.5 }} tickLine={false} axisLine={{ stroke: "var(--chart-axis)" }} />
          <YAxis tick={{ fill: "var(--chart-tick)", fontSize: 11.5 }} tickLine={false} axisLine={false} width={66} tickFormatter={(v) => compactNgn(v, "").trim()} />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--chart-cursor)" }} />
          {/* minPointSize keeps a small bucket visible when another dominates the
              linear scale. Without it the smaller bars round to sub pixel and the
              chart reads as a single oversized bar. */}
          <Bar
            dataKey="value"
            radius={[6, 6, 0, 0]}
            maxBarSize={56}
            minPointSize={3}
            isAnimationActive={!reduceMotion()}
          >
            {data.map((d) => (
              <Cell key={d.label} fill={empty ? "var(--chart-empty)" : d.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
