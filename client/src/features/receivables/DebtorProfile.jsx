import { useEffect, useMemo, useState } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BellRing, FileText, Receipt, Wallet, X } from "lucide-react";
import http from "../../api/http";
import { Button, Card, Modal, PageHeader, SkeletonBlock, StatusPill } from "../../components/ui";
import { ngn, dateTime, shortDate, METHOD_LABEL } from "./format";
import ReliabilityBadge from "./ReliabilityBadge";
import DebtorStatement from "./DebtorStatement";

const TL_ICON = {
  debt_created: <FileText size={13} />,
  payment: <Wallet size={13} />,
  reminder: <BellRing size={13} />,
};

function BehaviourChart({ timeline }) {
  const data = useMemo(() => {
    let cum = 0;
    return timeline
      .filter((e) => e.type === "payment")
      .map((e) => {
        cum += e.amount || 0;
        return { t: new Date(e.at).getTime(), collected: cum };
      });
  }, [timeline]);

  if (data.length < 2) {
    return <p className="muted small" style={{ margin: 0 }}>Not enough payments yet to chart behaviour.</p>;
  }
  return (
    <div className="rec-chart-frame">
      <ResponsiveContainer width="100%" height={160}>
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <defs>
            <linearGradient id="behav" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-b)" stopOpacity={0.12} />
              <stop offset="100%" stopColor="var(--chart-b)" stopOpacity={0.12} />
            </linearGradient>
          </defs>
          <XAxis dataKey="t" tickFormatter={(t) => shortDate(t)} tick={{ fill: "var(--muted)", fontSize: 11 }} tickLine={false} axisLine={{ stroke: "var(--line)" }} minTickGap={40} />
          <YAxis tick={{ fill: "var(--muted)", fontSize: 11 }} tickLine={false} axisLine={false} width={56} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
          <Tooltip
            content={({ active, payload }) =>
              active && payload && payload.length ? (
                <div className="chart-tooltip">
                  <div className="overline">{shortDate(payload[0].payload.t)}</div>
                  <div className="num mono-strong">{ngn(payload[0].value)} collected</div>
                </div>
              ) : null
            }
          />
          <Area type="monotone" dataKey="collected" stroke="var(--chart-b)" strokeWidth={1.75} fill="url(#behav)" dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function DebtorProfile({ debtorKey, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [statement, setStatement] = useState(null);

  useEffect(() => {
    let active = true;
    http
      .get(`/api/debtors/${encodeURIComponent(debtorKey)}`)
      .then(({ data }) => active && setData(data))
      .catch((err) => active && setError(err?.response?.data?.error || "Failed to load debtor"));
    return () => {
      active = false;
    };
  }, [debtorKey]);

  async function openStatement() {
    try {
      const { data } = await http.get(`/api/debtors/${encodeURIComponent(debtorKey)}/statement`);
      setStatement(data.statement);
    } catch {
    }
  }

  if (statement) {
    return <DebtorStatement statement={statement} onClose={() => setStatement(null)} />;
  }

  const debtor = data?.debtor;

  return (
    <Modal
      label="Debtor profile"
      view="debtor"
      crumb={debtor ? debtor.debtorName : "Debtor profile"}
      onClose={onClose}
      size="lg"
    >
      {error ? (
        <p className="error-text">{error}</p>
      ) : !data ? (
        <>
          <SkeletonBlock height={60} />
          <SkeletonBlock height={160} />
          <SkeletonBlock height={200} />
        </>
      ) : (
        <>
          <PageHeader
            title={debtor.debtorName}
            support={
              <span className="row wrap">
                <ReliabilityBadge score={debtor.reliabilityScore} band={debtor.band} />
                <span className="num">{debtor.debtorPhone || `${debtor.debtCount} debts`}</span>
              </span>
            }
            action={
              <Button variant="ghost" icon title="Close" onClick={onClose}>
                <X size={16} />
              </Button>
            }
          />

          <Card title="Details">
          <div className="detail-stats">
            <div className="detail-stat"><span className="overline">Borrowed in total</span><span className="num">{ngn(debtor.totalBorrowed)}</span></div>
            <div className="detail-stat"><span className="overline">Outstanding</span><span className={`num ${debtor.totalOutstanding > 0 ? "value-neg" : "value-pos"}`}>{ngn(debtor.totalOutstanding)}</span></div>
            <div className="detail-stat"><span className="overline">On time rate</span><span className="num">{debtor.onTimeRate != null ? `${Math.round(debtor.onTimeRate * 100)}%` : "Not yet"}</span></div>
            <div className="detail-stat"><span className="overline">Avg days to pay</span><span className="num">{debtor.avgDaysToPay != null ? debtor.avgDaysToPay : "Not yet"}</span></div>
          </div>
          </Card>

          <Card
            title="Payment behaviour"
            action={
              <Button size="sm" onClick={openStatement}>
                <FileText size={14} /> Statement
              </Button>
            }
          >
            <BehaviourChart timeline={data.timeline} />
          </Card>

          <Card title="Timeline">
            <ul className="timeline">
              {data.timeline
                .slice()
                .reverse()
                .map((e, i) => (
                  <li key={i} className="timeline-item">
                    <span className={`timeline-dot t-${e.type}`}>{TL_ICON[e.type] || <Receipt size={13} />}</span>
                    <div className="timeline-body">
                      <div className="timeline-title">
                        {e.type === "debt_created" && <>Debt recorded · {ngn(e.amount)}</>}
                        {e.type === "payment" && <>Payment · {ngn(e.amount)} <span className="muted">({METHOD_LABEL[e.method] || e.method})</span></>}
                        {e.type === "reminder" && <>Reminder <StatusPill status={e.status} /></>}
                      </div>
                      <div className="muted caption num">{dateTime(e.at)}</div>
                    </div>
                  </li>
                ))}
            </ul>
          </Card>
        </>
      )}
    </Modal>
  );
}
