import { lazy, Suspense, useState } from "react";
import { Receipt, CandlestickChart, Wallet, Landmark, LogOut } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import ReceivablesPage from "../features/receivables/ReceivablesPage";
import MarketWatchPage from "../features/market/MarketWatchPage";
// Wallet pulls in ethers + qrcode — code-split so those load only on demand.
const WalletPage = lazy(() => import("../features/wallet/WalletPage"));
import { Avatar, Button, Field, Input, Modal, Sidebar, Footer } from "../components/ui";
import PushToggle from "../components/PushToggle";

function PayoutForm({ onDone }) {
  const { user, updateProfile } = useAuth();
  const bd = user.bankDetails || {};
  const as = user.autoSend || {};
  const [form, setForm] = useState({
    accountName: bd.accountName || "",
    accountNumber: bd.accountNumber || "",
    bankName: bd.bankName || "",
  });
  const [autoSend, setAutoSend] = useState({
    enabled: Boolean(as.enabled),
    whatsapp: Boolean(as.whatsapp),
    email: Boolean(as.email),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const update = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const toggle = (k) => (e) => setAutoSend((a) => ({ ...a, [k]: e.target.checked }));

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await updateProfile({ bankDetails: form, autoSend });
      onDone();
    } catch (err) {
      setError(err?.response?.data?.error || "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div>
        <h3 className="section-title">Payout &amp; reminders</h3>
        <p className="muted small" style={{ margin: "4px 0 0" }}>
          Shown inside every payment reminder so debtors know exactly where to pay.
        </p>
      </div>
      <form onSubmit={save} className="stack">
        <div className="grid2">
          <Field label="Account name">
            <Input value={form.accountName} onChange={update("accountName")} autoFocus />
          </Field>
          <Field label="Account number">
            <Input
              value={form.accountNumber}
              onChange={update("accountNumber")}
              inputMode="numeric"
            />
          </Field>
          <Field label="Bank name">
            <Input value={form.bankName} onChange={update("bankName")} />
          </Field>
        </div>

        <div className="settings-section">
          <div className="overline">Automatic reminders</div>
          <p className="muted small" style={{ margin: "4px 0 12px" }}>
            When on, LedgerWatch sends due reminders for you through the channels you pick.
            Off by default — you stay in control.
          </p>
          <label className="toggle-row">
            <input type="checkbox" checked={autoSend.enabled} onChange={toggle("enabled")} />
            <span>
              <span className="toggle-title">Send reminders automatically</span>
              <span className="muted small">Otherwise reminders are drafted and you send them.</span>
            </span>
          </label>
          <label className={`toggle-row${autoSend.enabled ? "" : " is-disabled"}`}>
            <input
              type="checkbox"
              checked={autoSend.whatsapp}
              onChange={toggle("whatsapp")}
              disabled={!autoSend.enabled}
            />
            <span>
              <span className="toggle-title">WhatsApp</span>
              <span className="muted small">Requires a Twilio number configured on the server.</span>
            </span>
          </label>
          <label className={`toggle-row${autoSend.enabled ? "" : " is-disabled"}`}>
            <input
              type="checkbox"
              checked={autoSend.email}
              onChange={toggle("email")}
              disabled={!autoSend.enabled}
            />
            <span>
              <span className="toggle-title">Email</span>
              <span className="muted small">Only debtors with an email on file are contacted.</span>
            </span>
          </label>
        </div>

        {error && <p className="error-text">{error}</p>}
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <Button variant="ghost" onClick={onDone} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={busy}>
            {busy ? "Saving..." : "Save settings"}
          </Button>
        </div>
      </form>
    </div>
  );
}

const NAV_ITEMS = [
  { id: "receivables", label: "Receivables", icon: <Receipt size={16} /> },
  { id: "market", label: "Market Watch", icon: <CandlestickChart size={16} /> },
  { id: "wallet", label: "Wallet", icon: <Wallet size={16} /> },
];

const TAB_LABEL = { receivables: "Receivables", market: "Market Watch", wallet: "Wallet" };

export default function Dashboard() {
  const { user, logout } = useAuth();
  const [tab, setTab] = useState("receivables"); // "receivables" | "market" | "wallet"
  const [payoutOpen, setPayoutOpen] = useState(false);

  return (
    <div className="app-shell">
      <Sidebar
        items={NAV_ITEMS}
        value={tab}
        onChange={setTab}
        user={user}
        onLogout={logout}
        onOpenPayout={() => setPayoutOpen(true)}
      />

      <div className="main-col">
        {/* mobile-only top nav (sidebar collapses) */}
        <div className="mobile-topbar">
          <span className="wordmark">
            Ledger<span className="tick">Watch</span>
          </span>
          <div className="row wrap">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={tab === item.id ? "nav-item active" : "nav-item"}
                onClick={() => setTab(item.id)}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
            <Button variant="ghost" icon title="Payout details" onClick={() => setPayoutOpen(true)}>
              <Landmark size={15} />
            </Button>
            <Button variant="ghost" icon title="Sign out" onClick={logout}>
              <LogOut size={15} />
            </Button>
          </div>
        </div>

        {/* desktop content topbar */}
        <div className="content-topbar">
          <div className="breadcrumb">
            <span>LedgerWatch</span>
            <span className="sep">/</span>
            <span className="current">{TAB_LABEL[tab]}</span>
          </div>
          <div className="topbar-right">
            <span className={`sim-pill${tab === "wallet" ? " testnet" : ""}`}>
              <span className="dot" />
              {tab === "wallet" ? "Testnet" : "Simulated"}
            </span>
            <span className="user-chip">
              <Avatar name={user.name} />
              {user.name}
            </span>
          </div>
        </div>

        <main key={tab} className="page stack">
          {tab === "receivables" && <ReceivablesPage />}
          {tab === "market" && <MarketWatchPage />}
          {tab === "wallet" && (
            <Suspense fallback={<p className="muted">Loading wallet…</p>}>
              <WalletPage />
            </Suspense>
          )}
        </main>

        <Footer />
      </div>

      {payoutOpen && (
        <Modal label="Payout & reminders" onClose={() => setPayoutOpen(false)}>
          <PayoutForm onDone={() => setPayoutOpen(false)} />
          <PushToggle />
        </Modal>
      )}
    </div>
  );
}
