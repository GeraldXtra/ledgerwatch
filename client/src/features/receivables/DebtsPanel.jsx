import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BellRing, Download, Plus, Search } from "lucide-react";
import http from "../../api/http";
import {
  Button,
  Card,
  Field,
  Input,
  Modal,
  Select,
  SkeletonLines,
  StatCard,
  useToast,
} from "../../components/ui";
import { AlertCircle, CircleDollarSign, HandCoins, Users } from "lucide-react";
import { kpiNgn } from "./format";
import { downloadCsv } from "./csv";
import DebtList from "./DebtList";
import DebtForm from "./DebtForm";
import DebtDetailModal from "./DebtDetailModal";
import ReminderPanel from "./ReminderPanel";
import BulkActionBar from "./BulkActionBar";

function kpis(debts) {
  const totalOutstanding = debts.reduce((s, d) => s + (d.balance ?? d.amount ?? 0), 0);
  const overdue = debts.filter((d) => d.displayStatus === "overdue").length;
  const collected = debts.reduce((s, d) => s + (d.amountPaid || 0), 0);
  const activeDebtors = new Set(debts.filter((d) => (d.balance ?? d.amount) > 0).map((d) => d.debtorName)).size;
  return { totalOutstanding, overdue, collected, activeDebtors };
}

// Client-side sort so both asc (key_asc) and desc (key) work over the loaded list.
const SORT_CMP = {
  amount: (a, b) => a.amount - b.amount,
  balance: (a, b) => (a.balance ?? a.amount) - (b.balance ?? b.amount),
  due: (a, b) => new Date(a.dueDate) - new Date(b.dueDate),
  debtor: (a, b) => (a.debtorName || "").localeCompare(b.debtorName || ""),
  status: (a, b) => (a.displayStatus || "").localeCompare(b.displayStatus || ""),
};
function sortDebts(debts, sort) {
  if (!sort) return debts;
  const asc = sort.endsWith("_asc");
  const cmp = SORT_CMP[sort.replace(/_asc$/, "")];
  if (!cmp) return debts;
  const out = [...debts].sort(cmp);
  return asc ? out : out.reverse();
}

export default function DebtsPanel() {
  const toast = useToast();
  const [debts, setDebts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sort, setSort] = useState("");

  const [selected, setSelected] = useState(new Set());
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [detailId, setDetailId] = useState(null);
  const [reminder, setReminder] = useState(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  const debounceRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = {};
      if (search.trim()) params.search = search.trim();
      if (status) params.status = status;
      if (from) params.from = from;
      if (to) params.to = to;
      const { data } = await http.get("/api/debts", { params });
      setDebts(data.debts);
    } catch (err) {
      setError(err?.response?.data?.error || "Failed to load debts");
    } finally {
      setLoading(false);
    }
  }, [search, status, from, to]);

  // Debounce search; other filters apply immediately.
  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(debounceRef.current);
  }, [load, search]);

  // --- sorting toggles asc/desc via a "_asc" suffix (client-side) ---
  function onSort(key) {
    setSort((cur) => (cur === key ? `${key}_asc` : key));
  }
  const sortedDebts = useMemo(() => sortDebts(debts, sort), [debts, sort]);

  // --- selection ---
  function toggle(id) {
    setSelected((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected((s) => (s.size === debts.length ? new Set() : new Set(debts.map((d) => d._id))));
  }
  const clearSel = () => setSelected(new Set());

  // --- actions ---
  async function createDebt(payload) {
    await http.post("/api/debts", payload);
    setAdding(false);
    await load();
  }
  async function saveEdit(payload) {
    await http.patch(`/api/debts/${editing._id}`, payload);
    setEditing(null);
    await load();
  }
  async function deleteDebt(debt) {
    if (!window.confirm(`Delete debt for ${debt.debtorName}? This removes its payments and reminders.`)) return;
    await http.delete(`/api/debts/${debt._id}`);
    setDetailId(null);
    await load();
  }
  async function markPaid(debt) {
    await http.patch(`/api/debts/${debt._id}/paid`);
    toast(`${debt.debtorName}'s debt marked fully paid`, { type: "success" });
    await load();
  }
  async function generateReminder(debt) {
    const { data } = await http.post(`/api/debts/${debt._id}/remind`);
    setReminder({ debt, result: data });
    await load();
  }

  async function remindMany(targets, label) {
    if (targets.length === 0) {
      toast("No matching debts to remind.", { type: "info" });
      return;
    }
    setBulkBusy(true);
    let ok = 0;
    for (const d of targets) {
      try {
        await http.post(`/api/debts/${d._id}/remind`);
        ok++;
      } catch {
        /* skip */
      }
    }
    setBulkBusy(false);
    clearSel();
    toast(`Generated ${ok} reminder${ok === 1 ? "" : "s"}${label ? ` (${label})` : ""}.`, { type: "success" });
    await load();
  }

  function remindAllOverdue() {
    remindMany(debts.filter((d) => d.displayStatus === "overdue"), "overdue");
  }
  function remindSelected() {
    remindMany(debts.filter((d) => selected.has(d._id)), "selected");
  }

  function exportCsv() {
    downloadCsv(
      "debts.csv",
      ["Debtor", "Phone", "Amount", "Paid", "Balance", "Due date", "Status"],
      debts.map((d) => [
        d.debtorName,
        d.debtorPhone || "",
        d.amount,
        d.amountPaid || 0,
        d.balance ?? d.amount,
        new Date(d.dueDate).toISOString().slice(0, 10),
        d.displayStatus,
      ])
    );
  }

  const k = kpis(debts);
  const overdueCount = debts.filter((d) => d.displayStatus === "overdue").length;
  const detailDebt = detailId ? debts.find((d) => d._id === detailId) : null;

  return (
    <>
      {loading && debts.length === 0 ? (
        <div className="kpi-row">
          <SkeletonBlockRow />
        </div>
      ) : (
        <div className="kpi-row">
          <StatCard label="Total outstanding" countTo={k.totalOutstanding} format={kpiNgn} icon={<CircleDollarSign size={17} />} iconTone={k.totalOutstanding > 0 ? "neg" : "neutral"} hint="Sum of open balances" />
          <StatCard label="Overdue" countTo={overdueCount} tone={overdueCount > 0 ? "neg" : undefined} iconTone={overdueCount > 0 ? "neg" : "neutral"} icon={<AlertCircle size={17} />} hint={overdueCount === 1 ? "debt past due" : "debts past due"} />
          <StatCard label="Collected (shown)" countTo={k.collected} format={kpiNgn} tone={k.collected > 0 ? "pos" : undefined} iconTone="pos" icon={<HandCoins size={17} />} hint="Across the filtered list" />
          <StatCard label="Active clients" countTo={k.activeDebtors} icon={<Users size={17} />} iconTone="neutral" hint="With an open balance" />
        </div>
      )}

      <Card
        eyebrow="Ledger"
        title="Debts"
        subtitle={`${debts.length} result${debts.length === 1 ? "" : "s"}`}
        action={
          <div className="row wrap">
            <Button size="sm" variant="ghost" onClick={remindAllOverdue} disabled={bulkBusy || overdueCount === 0}>
              <BellRing size={14} /> Remind all overdue
            </Button>
            <Button size="sm" variant="ghost" onClick={exportCsv} disabled={debts.length === 0}>
              <Download size={14} /> CSV
            </Button>
            <Button size="sm" variant="primary" onClick={() => setAdding(true)}>
              <Plus size={14} /> Record debt
            </Button>
          </div>
        }
      >
        <div className="filters-row">
          <div className="search-field grow">
            <Search size={15} className="search-icon" />
            <Input
              className="grow"
              placeholder="Search by name or phone"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search debts"
            />
          </div>
          <Field>
            <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
              <option value="">All statuses</option>
              <option value="pending">Pending</option>
              <option value="partially_paid">Partial</option>
              <option value="paid">Paid</option>
            </Select>
          </Field>
          <Field>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Due from" title="Due from" />
          </Field>
          <Field>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Due to" title="Due to" />
          </Field>
        </div>

        {error && <p className="error-text">{error}</p>}
        {loading ? (
          <SkeletonLines count={4} />
        ) : (
          <DebtList
            debts={sortedDebts}
            sort={sort}
            onSort={onSort}
            selected={selected}
            onToggle={toggle}
            onToggleAll={toggleAll}
            onOpen={(d) => setDetailId(d._id)}
            onEdit={setEditing}
            onDelete={deleteDebt}
            onMarkPaid={markPaid}
            onRemind={generateReminder}
            onRecordPayment={(d) => setDetailId(d._id)}
            onAdd={() => setAdding(true)}
          />
        )}
      </Card>

      <BulkActionBar count={selected.size} onRemind={remindSelected} onClear={clearSel} busy={bulkBusy} />

      {adding && (
        <Modal label="Record a debt" onClose={() => setAdding(false)}>
          <DebtForm onSubmit={createDebt} onCancel={() => setAdding(false)} />
        </Modal>
      )}
      {editing && (
        <Modal label={`Edit debt for ${editing.debtorName}`} onClose={() => setEditing(null)}>
          <DebtForm initial={editing} onSubmit={saveEdit} onCancel={() => setEditing(null)} />
        </Modal>
      )}
      {detailDebt && (
        <DebtDetailModal
          debt={detailDebt}
          onClose={() => setDetailId(null)}
          onRemind={generateReminder}
          onMarkPaid={markPaid}
          onEdit={(d) => { setDetailId(null); setEditing(d); }}
          onDelete={deleteDebt}
          onChanged={load}
        />
      )}
      {reminder && (
        <ReminderPanel debt={reminder.debt} result={reminder.result} onClose={() => setReminder(null)} />
      )}
    </>
  );
}

// Local helper: a row of skeleton blocks for the KPI row.
function SkeletonBlockRow() {
  return (
    <>
      <div className="skeleton sk-block" style={{ height: 110 }} />
      <div className="skeleton sk-block" style={{ height: 110 }} />
      <div className="skeleton sk-block" style={{ height: 110 }} />
      <div className="skeleton sk-block" style={{ height: 110 }} />
    </>
  );
}
