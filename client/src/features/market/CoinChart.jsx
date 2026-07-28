import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { LineChart } from "lucide-react";
import http from "../../api/http";
import { EmptyState, SkeletonBlock } from "../../components/ui";
import { price as fmtPrice } from "./format";

const FRAMES = [
  { days: 1, label: "24H" },
  { days: 7, label: "7D" },
  { days: 30, label: "30D" },
  { days: 90, label: "90D" },
];

const reduceMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function ChartTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const p = payload[0].payload;
  return (
    <div className="chart-tooltip">
      <div className="overline">{new Date(p.t).toLocaleString()}</div>
      <div className="mono-strong num">{fmtPrice(p.p)}</div>
    </div>
  );
}

/**
 * Real interactive coin chart from /api/coins/:id/chart. Timeframe buttons refetch;
 * area chart with a gradient tinted to the line color; line green when the period is up,
 * muted red when down. Skeleton while loading, designed empty state if no data.
 */
export default function CoinChart({ coinId, defaultDays = 7 }) {
  const [days, setDays] = useState(defaultDays);
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setFailed(false);
    http
      .get(`/api/coins/${coinId}/chart`, { params: { days } })
      .then(({ data: res }) => {
        if (!active) return;
        const series = (res.prices || []).map(([t, p]) => ({ t, p }));
        setData(series);
      })
      .catch(() => active && setFailed(true))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [coinId, days]);

  const up = data.length >= 2 ? data[data.length - 1].p >= data[0].p : true;
  const stroke = up ? "var(--pos-text)" : "var(--neg-text)";
  const gradId = `cg-${coinId}`;

  const fmtX = (t) => {
    const d = new Date(t);
    return days <= 1
      ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : d.toLocaleDateString([], { month: "short", day: "numeric" });
  };

  return (
    <div className="coin-chart">
      <div className="timeframe-row">
        {FRAMES.map((f) => (
          <button
            key={f.days}
            type="button"
            className={`timeframe-btn ${days === f.days ? "active" : ""}`}
            onClick={() => setDays(f.days)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="coin-chart-frame">
        {loading ? (
          <SkeletonBlock height={220} />
        ) : failed || data.length < 2 ? (
          <EmptyState
            icon={<LineChart size={20} />}
            title="No chart data"
            hint="This coin's price history is unavailable right now. Try another timeframe or check back shortly."
          />
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
              <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={stroke} stopOpacity={0.14} />
                  <stop offset="100%" stopColor={stroke} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#EEF2F7" vertical={false} />
              <XAxis
                dataKey="t"
                tickFormatter={fmtX}
                tick={{ fill: "#64748B", fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: "#E5E8ED" }}
                minTickGap={48}
              />
              <YAxis
                orientation="right"
                tick={{ fill: "#64748B", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={64}
                domain={["auto", "auto"]}
                tickFormatter={(v) => fmtPrice(v)}
              />
              <Tooltip content={<ChartTooltip />} cursor={{ stroke: "#D6DBE3" }} />
              <Area
                type="monotone"
                dataKey="p"
                stroke={stroke}
                strokeWidth={1.75}
                fill={`url(#${gradId})`}
                dot={false}
                isAnimationActive={!reduceMotion()}
                activeDot={{ r: 3, fill: stroke, stroke: "#fff", strokeWidth: 2 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
