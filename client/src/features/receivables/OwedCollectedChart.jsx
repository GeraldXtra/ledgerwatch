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
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} margin={{ top: 10, right: 8, bottom: 0, left: 8 }} barGap={3} barCategoryGap="14%">
          <CartesianGrid stroke="#F1F4F9" vertical={false} />
          <XAxis dataKey="month" tick={{ fill: "#64748B", fontSize: 11.5 }} tickLine={false} axisLine={{ stroke: "#E1E7F0" }} />
          <YAxis tick={{ fill: "#64748B", fontSize: 11.5 }} tickLine={false} axisLine={false} width={66} tickFormatter={(v) => compactNgn(v, "").trim()} />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(22,41,74,0.05)" }} />
          <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
          {/* Invoiced is navy (money owed, neutral); collected is the semantic
              green (money actually received). The old gold Invoiced bar was the
              mustard tone, gone, with the palette itself left untouched. */}
          <Bar dataKey="owed" name="Invoiced" fill="#47689F" radius={[6, 6, 0, 0]} maxBarSize={44} minPointSize={2} isAnimationActive={!reduceMotion()} />
          <Bar dataKey="collected" name="Collected" fill="#0A6E4C" radius={[6, 6, 0, 0]} maxBarSize={44} minPointSize={2} isAnimationActive={!reduceMotion()} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
