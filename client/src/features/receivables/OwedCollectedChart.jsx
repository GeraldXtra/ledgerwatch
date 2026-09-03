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
          <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
          <XAxis dataKey="month" tick={{ fill: "var(--chart-tick)", fontSize: 11.5 }} tickLine={false} axisLine={{ stroke: "var(--chart-axis)" }} />
          <YAxis tick={{ fill: "var(--chart-tick)", fontSize: 11.5 }} tickLine={false} axisLine={false} width={66} tickFormatter={(v) => compactNgn(v, "").trim()} />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--chart-cursor)" }} />
          <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
          {/* Invoiced is navy (money owed, neutral); collected is the semantic
              green (money actually received). Both are theme tokens so the
              dark theme gets a navy that shows on a dark card. */}
          <Bar dataKey="owed" name="Invoiced" fill="var(--chart-navy)" radius={[6, 6, 0, 0]} maxBarSize={44} minPointSize={2} isAnimationActive={!reduceMotion()} />
          <Bar dataKey="collected" name="Collected" fill="var(--chart-pos)" radius={[6, 6, 0, 0]} maxBarSize={44} minPointSize={2} isAnimationActive={!reduceMotion()} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
