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

  /**
   * RETRIES, because one attempt was not enough and "No chart data" was a lie.
   *
   * This fetched once. The server builds its chart cache on demand from the
   * price provider, so the very first request for a coin can come back empty
   * while that fill is still in flight or after a rate limited attempt — and an
   * empty `prices` array is a RESOLVED response, not an error, so the old code
   * treated it as "this coin has no history" and rendered the empty state
   * permanently. Reopening the modal was the only way to try again, which is
   * why the chart appeared only after a reload.
   *
   * An empty series is therefore retried like a failure, with a widening delay,
   * and only the last attempt is allowed to conclude there is genuinely nothing.
   */
  useEffect(() => {
    let active = true;
    setLoading(true);
    setFailed(false);

    (async () => {
      for (let attempt = 0; attempt <= 3; attempt++) {
        try {
          const { data: res } = await http.get(`/api/coins/${coinId}/chart`, {
            params: { days },
          });
          if (!active) return;
          const series = (res.prices || []).map(([t, p]) => ({ t, p }));
          if (series.length >= 2) {
            setData(series);
            setFailed(false);
            setLoading(false);
            return;
          }
        } catch {
          if (!active) return;
        }

        if (attempt === 3) {
          if (!active) return;
          setFailed(true);
          setLoading(false);
          return;
        }
        await new Promise((r) => setTimeout(r, 2500 * Math.pow(2, attempt)));
        if (!active) return;
      }
    })();

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
