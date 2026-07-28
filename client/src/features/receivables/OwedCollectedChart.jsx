import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
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

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="chart-tooltip">
      <div className="overline">{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} className="num small row" style={{ gap: 6 }}>
          <span className="legend-swatch" style={{ background: p.color }} />
          {p.name}: {ngn(p.value)}
        </div>
      ))}
    </div>
  );
}

/**
 * 6-month owed (invoiced) vs collected (payments received) grouped bar chart.
 * `data` = [{ month, owed, collected }].
 */
export default function OwedCollectedChart({ data }) {
  return (
    <div className="rec-chart-frame">
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }} barGap={4} barCategoryGap="16%">
          <CartesianGrid stroke="#EEF2F7" vertical={false} />
          <XAxis dataKey="month" tick={{ fill: "#64748B", fontSize: 11 }} tickLine={false} axisLine={{ stroke: "#E1E7F0" }} />
          <YAxis tick={{ fill: "#64748B", fontSize: 11 }} tickLine={false} axisLine={false} width={64} tickFormatter={(v) => compactNgn(v, "").trim()} />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(22,41,74,0.05)" }} />
          <Legend wrapperStyle={{ fontSize: 12, paddingTop: 6 }} />
          <Bar dataKey="owed" name="Invoiced" fill="#C0A053" radius={[4, 4, 0, 0]} maxBarSize={38} isAnimationActive={!reduceMotion()} />
          <Bar dataKey="collected" name="Collected" fill="#0A6E4C" radius={[4, 4, 0, 0]} maxBarSize={38} isAnimationActive={!reduceMotion()} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
