import { useEffect, useMemo, useState } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BellRing, FileText, Receipt, Wallet, X } from "lucide-react";
import http from "../../api/http";
import { Avatar, Button, Modal, SkeletonBlock, StatusPill } from "../../components/ui";
import { ngn, dateTime, shortDate, METHOD_LABEL } from "./format";
import ReliabilityBadge from "./ReliabilityBadge";
import DebtorStatement from "./DebtorStatement";

const TL_ICON = {
  debt_created: <FileText size={13} />,
  payment: <Wallet size={13} />,
  reminder: <BellRing size={13} />,
};

function BehaviourChart({ timeline }) {
  // Cumulative collected over time from payment events.
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
              <stop offset="0%" stopColor="var(--chart-pos)" stopOpacity={0.16} />
              <stop offset="100%" stopColor="var(--chart-pos)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="t" tickFormatter={(t) => shortDate(t)} tick={{ fill: "var(--chart-tick)", fontSize: 11 }} tickLine={false} axisLine={{ stroke: "var(--chart-axis)" }} minTickGap={40} />
          <YAxis tick={{ fill: "var(--chart-tick)", fontSize: 11 }} tickLine={false} axisLine={false} width={56} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
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
          <Area type="monotone" dataKey="collected" stroke="var(--chart-pos)" strokeWidth={1.75} fill="url(#behav)" dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Debtor profile modal: header with reliability, cumulative-collected chart,
 * a chronological timeline, and a link to the printable statement.
 */
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
      /* ignore */
    }
  }

  if (statement) {
    return <DebtorStatement statement={statement} onClose={() => setStatement(null)} />;
  }

  const debtor = data?.debtor;

  return (
    <Modal label="Debtor profile" onClose={onClose} size="lg">
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
          <div className="row space-between coin-detail-head">
            <div className="row">
              <Avatar name={debtor.debtorName} size="lg" />
              <div>
                <h3 className="section-title">{debtor.debtorName}</h3>
                <div className="muted small num">{debtor.debtorPhone || `${debtor.debtCount} debts`}</div>
              </div>
            </div>
            <div className="row">
              <ReliabilityBadge score={debtor.reliabilityScore} band={debtor.band} />
              <Button variant="ghost" icon title="Close" onClick={onClose}>
                <X size={16} />
              </Button>
            </div>
          </div>

          <div className="detail-stats">
            <div className="detail-stat"><span className="overline">Borrowed in total</span><span className="num mono-strong">{ngn(debtor.totalBorrowed)}</span></div>
            <div className="detail-stat"><span className="overline">Outstanding</span><span className={`num mono-strong ${debtor.totalOutstanding > 0 ? "value-neg" : "value-pos"}`}>{ngn(debtor.totalOutstanding)}</span></div>
            <div className="detail-stat"><span className="overline">On time rate</span><span className="num mono-strong">{debtor.onTimeRate != null ? `${Math.round(debtor.onTimeRate * 100)}%` : "Not yet"}</span></div>
            <div className="detail-stat"><span className="overline">Avg days to pay</span><span className="num mono-strong">{debtor.avgDaysToPay != null ? debtor.avgDaysToPay : "Not yet"}</span></div>
          </div>

          <div className="detail-section">
            <div className="row space-between">
              <span className="overline">Payment behaviour</span>
              <Button size="sm" variant="ghost" onClick={openStatement}>
                <FileText size={14} /> Statement
              </Button>
            </div>
            <BehaviourChart timeline={data.timeline} />
          </div>

          <div className="detail-section">
            <span className="overline">Timeline</span>
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
          </div>
        </>
      )}
    </Modal>
  );
}
