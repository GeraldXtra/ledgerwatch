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

// Single-hue gold intensity ramp — deeper gold = older money. "Current" stays
// green (it is not overdue); everything overdue darkens through the accent.
const BUCKETS = [
  { key: "current", label: "Current", color: "#0A6E4C" },
  { key: "d1_30", label: "1–30d", color: "#EADFC0" },
  { key: "d31_60", label: "31–60d", color: "#D4BC80" },
  { key: "d61_90", label: "61–90d", color: "#C0A053" },
  { key: "d90plus", label: "90d+", color: "#9A7726" },
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
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }} barCategoryGap="16%">
          <CartesianGrid stroke="#EEF2F7" vertical={false} />
          <XAxis dataKey="label" tick={{ fill: "#64748B", fontSize: 11 }} tickLine={false} axisLine={{ stroke: "#E1E7F0" }} />
          <YAxis tick={{ fill: "#64748B", fontSize: 11 }} tickLine={false} axisLine={false} width={64} tickFormatter={(v) => compactNgn(v, "").trim()} />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(22,41,74,0.05)" }} />
          <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={46} isAnimationActive={!reduceMotion()}>
            {data.map((d) => (
              <Cell key={d.label} fill={empty ? "#E5E8ED" : d.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
