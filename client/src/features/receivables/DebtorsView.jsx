import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, Users } from "lucide-react";
import http from "../../api/http";
import { Avatar, Card, EmptyState, SkeletonLines } from "../../components/ui";
import { ngn, shortDate } from "./format";
import ReliabilityBadge from "./ReliabilityBadge";
import DebtorProfile from "./DebtorProfile";

const SORTS = {
  name: (a, b) => (a.debtorName || "").localeCompare(b.debtorName || ""),
  outstanding: (a, b) => a.totalOutstanding - b.totalOutstanding,
  score: (a, b) => (a.reliabilityScore ?? -1) - (b.reliabilityScore ?? -1),
  activity: (a, b) => new Date(a.lastActivityAt || 0) - new Date(b.lastActivityAt || 0),
};

export default function DebtorsView() {
  const [debtors, setDebtors] = useState(null);
  const [error, setError] = useState("");
  const [sort, setSort] = useState("outstanding");
  const [dir, setDir] = useState("desc");
  const [openKey, setOpenKey] = useState(null);

  useEffect(() => {
    let active = true;
    http
      .get("/api/debtors")
      .then(({ data }) => active && setDebtors(data.debtors))
      .catch((err) => active && setError(err?.response?.data?.error || "Failed to load debtors"));
    return () => {
      active = false;
    };
  }, []);

  const sorted = useMemo(() => {
    if (!debtors) return [];
    const cmp = SORTS[sort] || SORTS.outstanding;
    const out = [...debtors].sort(cmp);
    if (dir === "desc") out.reverse();
    return out;
  }, [debtors, sort, dir]);

  function toggleSort(key) {
    if (sort === key) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSort(key);
      setDir(key === "name" ? "asc" : "desc");
    }
  }
  const arrow = (key) => (sort === key ? (dir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : null);

  return (
    <Card
      eyebrow="Customers"
      title="Debtors"
      subtitle="Every customer grouped, with a reliability score from their payment history."
    >
      {error && <p className="error-text">{error}</p>}
      {!debtors ? (
        <SkeletonLines count={5} />
      ) : debtors.length === 0 ? (
        <EmptyState
          icon={<Users size={20} />}
          title="No clients yet"
          hint="Record an invoice and your clients appear here with a reliability score as they build a payment history."
          action={
            <Link to="/app/receivables" className="btn btn-primary btn-sm">
              Record your first invoice
            </Link>
          }
        />
      ) : (
        <div className="table-wrap">
          <table className="table table-stack debtors-table">
            <thead>
              <tr>
                <th><button type="button" className="th-sort" onClick={() => toggleSort("name")}>Debtor {arrow("name")}</button></th>
                <th className="ta-right"><button type="button" className="th-sort right" onClick={() => toggleSort("outstanding")}>Outstanding {arrow("outstanding")}</button></th>
                <th><button type="button" className="th-sort" onClick={() => toggleSort("score")}>Reliability {arrow("score")}</button></th>
                <th className="ta-right"><button type="button" className="th-sort right" onClick={() => toggleSort("activity")}>Last activity {arrow("activity")}</button></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((d) => (
                <tr key={d.key} className="clickable-row" onClick={() => setOpenKey(d.key)}>
                  <td data-label="Debtor">
                    <div className="cell-lead">
                      <Avatar name={d.debtorName} />
                      <div>
                        <div className="lead-name">{d.debtorName}</div>
                        <div className="lead-sub num">{d.debtorPhone || `${d.debtCount} debt${d.debtCount === 1 ? "" : "s"}`}</div>
                      </div>
                    </div>
                  </td>
                  <td data-label="Outstanding" align="right" className="ta-right num">{ngn(d.totalOutstanding)}</td>
                  <td data-label="Reliability"><ReliabilityBadge score={d.reliabilityScore} band={d.band} /></td>
                  <td data-label="Last activity" align="right" className="ta-right num">
                    {d.lastActivityAt ? shortDate(d.lastActivityAt) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {openKey && <DebtorProfile debtorKey={openKey} onClose={() => setOpenKey(null)} />}
    </Card>
  );
}
