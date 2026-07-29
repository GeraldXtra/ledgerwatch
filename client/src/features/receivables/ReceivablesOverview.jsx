import { useEffect, useState } from "react";
import { AlertCircle, CalendarClock, HandCoins, Percent, TrendingUp } from "lucide-react";
import http from "../../api/http";
import { Card, SkeletonBlock, StatCard } from "../../components/ui";
import { kpiNgn } from "./format";
import OwedCollectedChart from "./OwedCollectedChart";
import AgingChart from "./AgingChart";

/**
 * Analytics overview: KPI cards + two real charts (6-month owed vs collected, and
 * an aging breakdown). Driven by GET /api/receivables/analytics.
 */
export default function ReceivablesOverview() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    http
      .get("/api/receivables/analytics")
      .then(({ data }) => active && setData(data))
      .catch((err) => active && setError(err?.response?.data?.error || "Failed to load analytics"));
    return () => {
      active = false;
    };
  }, []);

  if (error) return <p className="error-text">{error}</p>;

  if (!data) {
    return (
      <>
        <div className="kpi-row">
          <SkeletonBlock height={110} />
          <SkeletonBlock height={110} />
          <SkeletonBlock height={110} />
          <SkeletonBlock height={110} />
        </div>
        <div className="grid2">
          <SkeletonBlock height={300} />
          <SkeletonBlock height={300} />
        </div>
      </>
    );
  }

  const overdue = data.countByStatus.overdue || 0;

  return (
    <>
      <div className="kpi-row">
        <StatCard label="Total outstanding" countTo={data.totalOutstanding} format={kpiNgn} icon={<AlertCircle size={17} />} iconTone={data.totalOutstanding > 0 ? "neg" : "neutral"} hint="Across all open balances" />
        <StatCard label="Collected this month" countTo={data.collectedThisMonth} format={kpiNgn} tone={data.collectedThisMonth > 0 ? "pos" : undefined} iconTone="pos" icon={<HandCoins size={17} />} hint="Payments received this month" />
        <StatCard label="Collection rate" countTo={data.collectionRate} format={(n) => `${Math.round(n)}%`} icon={<Percent size={17} />} iconTone="accent" hint="Of all money invoiced" />
        {data.avgDaysToPayment != null ? (
          <StatCard label="Avg days to pay" countTo={data.avgDaysToPayment} format={(n) => String(Math.round(n))} icon={<CalendarClock size={17} />} iconTone="neutral" hint="From invoice to full settlement" />
        ) : (
          <StatCard label="Avg days to pay" value="—" icon={<CalendarClock size={17} />} iconTone="neutral" hint="From invoice to full settlement" />
        )}
      </div>

      <div className="grid2 overview-charts">
        <Card eyebrow="Cash flow" title="Invoiced vs collected" subtitle="The last six months of money owed against money received." icon={<TrendingUp size={17} />}>
          <OwedCollectedChart data={data.monthly} />
        </Card>
        <Card eyebrow="Risk" title="Aging of outstanding money" subtitle="How overdue your unpaid balances are." icon={<AlertCircle size={17} />}>
          <AgingChart aging={data.aging} />
          {overdue > 0 && (
            <p className="muted small" style={{ marginTop: 10 }}>
              {overdue} debt{overdue === 1 ? "" : "s"} past due. Chase the oldest buckets first.
            </p>
          )}
        </Card>
      </div>
    </>
  );
}
