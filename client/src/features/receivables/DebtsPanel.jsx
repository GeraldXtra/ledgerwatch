import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { fetchPaymentAddresses } from "./cryptoApi";
import { hasWallet } from "../wallet/keystore";
import { useAuth } from "../../context/AuthContext";

// Lazy, on purpose. This modal reaches ethers (for HD derivation) and qrcode,
// which together are the largest dependency in the app. Importing it eagerly
// pulls both into the main bundle, so every user would download the crypto
// stack just to open the dashboard — the wallet is code-split for exactly this
// reason. cryptoApi itself is a plain http wrapper and stays eager.
const CryptoPaymentModal = lazy(() => import("./CryptoPaymentModal"));

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

// `onLedgerChanged` is called after anything that moves money, so the figures
// rail at the top of the page can restate itself instead of showing the numbers
// it read when the page first loaded.
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

  // Crypto payment addresses. `cryptoIds` drives the ledger indicator, so the
  // table can show which invoices are awaiting a stablecoin payment without
  // anyone having to open each one. `cryptoKey` bumps to re-read after an
  // address is issued or revoked.
  //
  // A Map rather than a Set: the chip used to print the literal "USDC" for every
  // row, and an invoice can be issued in USDT wherever a verified contract
  // exists. The symbol the payer was actually told to send is carried alongside
  // the id so the ledger never names the wrong token.
  const [cryptoDebt, setCryptoDebt] = useState(null);
  const [cryptoIds, setCryptoIds] = useState(() => new Map());
  const [cryptoKey, setCryptoKey] = useState(0);
  // Set when Generate Reminder had to issue an address first, so the reminder can
  // be generated as soon as that address exists.
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

  /**
   * Reload the ledger AND tell the page the figures moved.
   *
   * Deliberately separate from `load`, which also runs on every debounced
   * keystroke in the search box: typing changes what is listed, not what is
   * owed, and refetching the analytics on each keystroke would be a request per
   * search with no new information in it.
   */
  const reloadAll = useCallback(async () => {
    await load();
    if (onLedgerChanged) onLedgerChanged();
  }, [load, onLedgerChanged]);

  // Debounce search; other filters apply immediately.
  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(debounceRef.current);
  }, [load, search]);

  // Which invoices have a live payment address. Deliberately independent of
  // `load` so retyping in the search box does not refetch it, and silent on
  // failure — the indicator is a convenience and must never break the ledger.
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
    await reloadAll();
  }
  async function saveEdit(payload) {
    await http.patch(`/api/debts/${editing._id}`, payload);
    setEditing(null);
    await reloadAll();
  }
  async function deleteDebt(debt) {
    /**
     * The old wording named the two harmless consequences and omitted the one
     * that cannot be undone: the invoice's crypto payment address goes too, and
     * with it the derivation index, which is the only record of which key
     * reaches any money sitting at that address. The server now refuses when an
     * address is still holding a confirmed balance; this says so up front, and
     * reports the refusal instead of failing silently.
     */
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
    // This had no error path: a failed request produced an unhandled rejection
    // and the screen did nothing at all, so the owner pressed the button again.
    // Marking an invoice paid changes what is owed, and a silent failure leaves
    // them chasing — or not chasing — on a balance they believe they corrected.
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
  /**
   * Generate a reminder, issuing the invoice's crypto payment address first if it
   * does not have one yet.
   *
   * WHY THIS CANNOT BE FULLY AUTOMATIC. The address is derived in the browser from
   * the wallet's own password on branch m/44'/60'/0'/2/<index>. The server holds no
   * key and must never hold one, so it cannot mint the address itself and the
   * reminder endpoint can only attach an address that already exists. Asking for
   * the password once, here, is the closest this can get to automatic without
   * breaking the single signing path the whole wallet design rests on.
   *
   * Order matters: the address must be saved BEFORE the reminder is generated,
   * because `generateReminderForDebt` looks up the active address and folds the
   * payment block into the message at generation time. Generating first would
   * produce a reminder with no payment details and no way to add them afterwards.
   */
  async function generateReminder(debt) {
    const wantsCrypto =
      user?.crypto?.enabled !== false && // account setting, defaults on
      hasWallet() && // a wallet exists in THIS browser for THIS account
      !cryptoIds.has(String(debt._id)) && // no active address yet
      (debt.balance ?? debt.amount) > 0; // nothing to ask for otherwise

    if (wantsCrypto) {
      // Hand off to the issuance modal, which owns the unlock, the atomic index
      // allocation and the derivation. Remember the debt so the reminder is
      // generated the moment the address lands.
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
      // This had no error path at all: a failure produced an unhandled rejection
      // and the user saw nothing happen.
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
    /**
     * EVERY FAILURE USED TO BE SWALLOWED AND THE RESULT ANNOUNCED IN GREEN.
     *
     * The loop counted successes, ignored every rejection, and then raised a
     * success toast built from that count — so with the server unreachable the
     * owner was congratulated with "Generated 0 reminders" and reasonably
     * concluded the work was done. The failures are counted and named now, and
     * the tone follows the outcome: green only when every one went through.
     */
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
            cryptoIds={cryptoIds}
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
          onChanged={reloadAll}
          onCrypto={(d) => { setDetailId(null); setCryptoDebt(d); }}
          cryptoKey={cryptoKey}
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
            // Cancelling the address must not silently cancel the reminder the
            // user actually asked for. Generate it without the payment block and
            // say why it is missing, rather than appearing to do nothing.
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
              // Straight on to the reminder. The address now exists, so generation
              // folds the payment block into the message.
              toast("Payment address created. Drafting the reminder.", { type: "success" });
              doGenerateReminder(pending);
              return;
            }
            // Land back on the invoice so the new address, QR and amount are
            // there to read immediately rather than being hunted for.
            setDetailId(id);
            toast("Payment address created. Share it with your client.", { type: "success" });
          }}
        />
        </Suspense>
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
