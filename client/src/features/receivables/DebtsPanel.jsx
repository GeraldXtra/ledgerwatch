import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BellRing, Download, Plus, Search } from "lucide-react";
import http from "../../api/http";
import {
  Button,
  Field,
  Input,
  Modal,
  PageHeader,
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
import { fetchPaymentAddresses } from "./cryptoApi";
import { hasWallet } from "../wallet/keystore";
import { useAuth } from "../../context/AuthContext";

const CryptoPaymentModal = lazy(() => import("./CryptoPaymentModal"));

function kpis(debts) {
  const totalOutstanding = debts.reduce((s, d) => s + (d.balance ?? d.amount ?? 0), 0);
  const overdue = debts.filter((d) => d.displayStatus === "overdue").length;
  const collected = debts.reduce((s, d) => s + (d.amountPaid || 0), 0);
  const activeDebtors = new Set(debts.filter((d) => (d.balance ?? d.amount) > 0).map((d) => d.debtorName)).size;
  return { totalOutstanding, overdue, collected, activeDebtors };
}

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

export default function DebtsPanel({ onLedgerChanged }) {
  const toast = useToast();
  const { user } = useAuth();
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

  const [cryptoDebt, setCryptoDebt] = useState(null);
  const [cryptoIds, setCryptoIds] = useState(() => new Map());
  const [cryptoKey, setCryptoKey] = useState(0);
  const [remindAfterAddress, setRemindAfterAddress] = useState(null);

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

  const reloadAll = useCallback(async () => {
    await load();
    if (onLedgerChanged) onLedgerChanged();
  }, [load, onLedgerChanged]);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(debounceRef.current);
  }, [load, search]);

  useEffect(() => {
    let active = true;
    fetchPaymentAddresses()
      .then((data) => {
        if (!active) return;
        const ids = (data.addresses || [])
          .filter((a) => a.status === "active")
          .map((a) => [String(a.debtId), a.tokenSymbol || null]);
        setCryptoIds(new Map(ids));
      })
      .catch(() => {
        if (active) setCryptoIds(new Map());
      });
    return () => {
      active = false;
    };
  }, [cryptoKey]);

  function onSort(key) {
    setSort((cur) => (cur === key ? `${key}_asc` : key));
  }
  const sortedDebts = useMemo(() => sortDebts(debts, sort), [debts, sort]);

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

  async function createDebt(payload) {
    await http.post("/api/debts", payload);
    setAdding(false);
    await reloadAll();
  }
  async function saveEdit(payload) {
    await http.patch(`/api/debts/${editing._id}`, payload);
    setEditing(null);
    await reloadAll();
  }
  async function deleteDebt(debt) {
    if (
      !window.confirm(
        `Delete the invoice for ${debt.debtorName}?

` +
          "This also removes its payments, its reminders and its crypto payment address. " +
          "If that address is still holding money, sweep it first."
      )
    )
      return;
    try {
      await http.delete(`/api/debts/${debt._id}`);
    } catch (err) {
      const data = err?.response?.data;
      if (data?.code === "unswept_funds") {
        const where = (data.addresses || [])
          .map((a) => `${a.address} (${a.tokenSymbol})`)
          .join(", ");
        toast(
          `${data.error}${where ? ` Address: ${where}` : ""}`,
          { type: "error", duration: 12000 }
        );
        return;
      }
      toast(data?.error || "The invoice could not be deleted.", { type: "error" });
      return;
    }
    setDetailId(null);
    await reloadAll();
  }
  async function markPaid(debt) {
    try {
      await http.patch(`/api/debts/${debt._id}/paid`);
    } catch (err) {
      toast(
        err?.response?.data?.error ||
          `${debt.debtorName}'s debt could NOT be marked paid. The balance is unchanged.`,
        { type: "error", duration: 9000 }
      );
      return;
    }
    toast(`${debt.debtorName}'s debt marked fully paid`, { type: "success" });
    await reloadAll();
  }
  async function generateReminder(debt) {
    const wantsCrypto =
      user?.crypto?.enabled !== false &&
      hasWallet() &&
      !cryptoIds.has(String(debt._id)) &&
      (debt.balance ?? debt.amount) > 0;

    if (wantsCrypto) {
      setRemindAfterAddress(debt);
      setCryptoDebt(debt);
      return;
    }
    await doGenerateReminder(debt);
  }

  async function doGenerateReminder(debt) {
    try {
      const { data } = await http.post(`/api/debts/${debt._id}/remind`);
      setReminder({ debt, result: data });
      await load();
    } catch (err) {
      toast(err?.response?.data?.error || "Could not generate the reminder.", { type: "error" });
    }
  }

  async function remindMany(targets, label) {
    if (targets.length === 0) {
      toast("No matching debts to remind.", { type: "info" });
      return;
    }
    setBulkBusy(true);
    let ok = 0;
    let failed = 0;
    let firstError = "";
    for (const d of targets) {
      try {
        await http.post(`/api/debts/${d._id}/remind`);
        ok++;
      } catch (err) {
        failed++;
        if (!firstError) firstError = err?.response?.data?.error || "";
      }
    }
    setBulkBusy(false);
    clearSel();
    const scope = label ? ` (${label})` : "";
    if (failed === 0) {
      toast(`Generated ${ok} reminder${ok === 1 ? "" : "s"}${scope}.`, { type: "success" });
    } else if (ok === 0) {
      toast(
        `No reminders were generated${scope}. All ${failed} failed.${firstError ? ` ${firstError}` : ""}`,
        { type: "error", duration: 9000 }
      );
    } else {
      toast(
        `Generated ${ok} of ${ok + failed} reminders${scope}. ${failed} failed.${firstError ? ` ${firstError}` : ""}`,
        { type: "error", duration: 9000 }
      );
    }
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
  const reminderInline = Boolean(reminder && detailDebt && reminder.debt._id === detailDebt._id);

  return (
    <>
      <PageHeader
        eyebrow="Ledger"
        title="Debts"
        count={debts.length}
        action={
          <>
            <Button onClick={remindAllOverdue} disabled={bulkBusy || overdueCount === 0}>
              <BellRing size={14} /> Remind all overdue
            </Button>
            <Button onClick={exportCsv} disabled={debts.length === 0}>
              <Download size={14} /> CSV
            </Button>
            <Button variant="primary" onClick={() => setAdding(true)}>
              <Plus size={14} /> Record debt
            </Button>
          </>
        }
      />
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

      <section className="card card-flush">
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
            cryptoIds={cryptoIds}
          />
        )}
      </section>

      <BulkActionBar count={selected.size} onRemind={remindSelected} onClear={clearSel} busy={bulkBusy} />

      {adding && (
        <Modal label="Record a debt" view="record" onClose={() => setAdding(false)}>
          <DebtForm onSubmit={createDebt} onCancel={() => setAdding(false)} />
        </Modal>
      )}
      {editing && (
        <Modal
          label={`Edit debt for ${editing.debtorName}`}
          view="edit"
          crumb="Edit debt"
          onClose={() => setEditing(null)}
        >
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
          onChanged={reloadAll}
          onCrypto={(d) => { setDetailId(null); setCryptoDebt(d); }}
          cryptoKey={cryptoKey}
          reminder={reminderInline ? reminder : null}
          onCloseReminder={() => setReminder(null)}
        />
      )}
      {cryptoDebt && (
        <Suspense fallback={null}>
        <CryptoPaymentModal
          debt={cryptoDebt}
          onClose={() => {
            const pending = remindAfterAddress;
            setCryptoDebt(null);
            setRemindAfterAddress(null);
            if (pending) {
              toast("Reminder drafted without payment details, because no address was issued.", { type: "info" });
              doGenerateReminder(pending);
            }
          }}
          onCreated={() => {
            const id = cryptoDebt._id;
            const pending = remindAfterAddress;
            setCryptoDebt(null);
            setRemindAfterAddress(null);
            setCryptoKey((k) => k + 1);
            if (pending) {
              toast("Payment address created. Drafting the reminder.", { type: "success" });
              doGenerateReminder(pending);
              return;
            }
            setDetailId(id);
            toast("Payment address created. Share it with your client.", { type: "success" });
          }}
        />
        </Suspense>
      )}
      {reminder && !reminderInline && (
        <ReminderPanel debt={reminder.debt} result={reminder.result} onClose={() => setReminder(null)} />
      )}
    </>
  );
}

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
