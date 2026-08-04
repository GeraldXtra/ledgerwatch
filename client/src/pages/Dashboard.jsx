import { Suspense, useEffect } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  Receipt,
  CandlestickChart,
  Wallet,
  Settings as SettingsIcon,
  LogOut,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { Avatar, Button, Sidebar, Footer, ToastProvider, useToast } from "../components/ui";
import { ensureServiceWorker, onForegroundPush } from "../api/push";

const NAV_ITEMS = [
  { id: "receivables", label: "Receivables", icon: <Receipt size={16} />, to: "/app/receivables" },
  { id: "market", label: "Market Watch", icon: <CandlestickChart size={16} />, to: "/app/market" },
  { id: "wallet", label: "Wallet", icon: <Wallet size={16} />, to: "/app/wallet" },
];

const TAB_LABEL = {
  receivables: "Receivables",
  market: "Market Watch",
  wallet: "Wallet",
  settings: "Settings",
};

/**
 * The single foreground-push bridge for the whole app.
 *
 * It lives in the shell rather than on one page because the service worker
 * suppresses the OS notification whenever a window is focused, and it has no idea
 * which route the user happens to be on. When the only listener sat inside
 * MarketWatchPage, a push that arrived while the user was on Settings or Wallet
 * produced neither an OS notification nor a toast — it vanished.
 *
 * Rendered inside a ToastProvider so it can toast on any route. Pages that mount
 * their own provider still resolve `useToast` to their nearest one, so nothing
 * about their existing toasts changes.
 */
function PushBridge() {
  const toast = useToast();

  useEffect(() => {
    ensureServiceWorker();

    return onForegroundPush((message) => {
      if (message.kind === "push") {
        const payload = message.payload || {};
        toast(payload.title ? `${payload.title} — ${payload.body || ""}` : payload.body || "", {
          type: payload.type === "alert" ? "info" : "success",
        });
        // Pages that want to react (refetch, open a panel) still listen for this.
        // It carries a `handled` marker so the alert poll does not toast the same
        // alert a second time.
        window.dispatchEvent(new CustomEvent("ledgerwatch:push", { detail: payload }));
        return;
      }

      if (message.kind === "action-result") {
        toast(
          message.ok
            ? "Done. That was actioned from the notification."
            : `That notification action failed. ${message.message || ""}`.trim(),
          { type: message.ok ? "success" : "error" }
        );
        window.dispatchEvent(new CustomEvent("ledgerwatch:push-action", { detail: message }));
      }
    });
  }, [toast]);

  return null;
}

export default function Dashboard() {
  const { user, logout } = useAuth();
  const location = useLocation();

  // Active section comes from the URL rather than local state.
  const tab = location.pathname.split("/")[2] || "receivables";

  return (
    // Shell-level provider so a foreground push can toast on ANY route. Pages
    // that mount their own provider are unaffected — useToast resolves to the
    // nearest one, which is still theirs.
    <ToastProvider>
      <PushBridge />
      <div className="app-shell">
        <Sidebar items={NAV_ITEMS} activeId={tab} user={user} onLogout={logout} />

        <div className="main-col">
          {/* mobile-only top nav (sidebar collapses) */}
          <div className="mobile-topbar">
            <span className="wordmark">
              Ledger<span className="tick">Watch</span>
            </span>
            <div className="row wrap">
              {NAV_ITEMS.map((item) => (
                <NavLink
                  key={item.id}
                  to={item.to}
                  className={({ isActive }) => (isActive ? "nav-item active" : "nav-item")}
                >
                  {item.icon}
                  {item.label}
                </NavLink>
              ))}
              <NavLink
                to="/app/settings"
                className={({ isActive }) => (isActive ? "nav-item active" : "nav-item")}
                title="Settings"
              >
                <SettingsIcon size={15} />
              </NavLink>
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
              <span className="current">{TAB_LABEL[tab] || "Receivables"}</span>
            </div>
            <div className="topbar-right">
              {/* Only labels that are actually true: the paper portfolio really is
                  simulated and the wallet really is testnet. Receivables is the
                  user's own ledger, so it carries no badge. */}
              {tab === "market" && (
                <span className="sim-pill">
                  <span className="dot" />
                  Simulated portfolio
                </span>
              )}
              {tab === "wallet" && (
                <span className="sim-pill testnet">
                  <span className="dot" />
                  Testnet
                </span>
              )}
              <NavLink to="/app/settings" className="user-chip" title="Settings">
                <Avatar name={user.name} src={user.avatarUrl} />
                {user.name}
              </NavLink>
            </div>
          </div>

          {/* keyed on the route so the entrance transition replays on navigation */}
          <main key={tab} className="page stack">
            <Suspense fallback={<p className="muted">Loading…</p>}>
              <Outlet />
            </Suspense>
          </main>

          <Footer />
        </div>
      </div>
    </ToastProvider>
  );
}
