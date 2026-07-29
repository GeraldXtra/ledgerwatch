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
import { Avatar, Button, Sidebar, Footer } from "../components/ui";
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

export default function Dashboard() {
  const { user, logout } = useAuth();
  const location = useLocation();

  // Active section comes from the URL rather than local state.
  const tab = location.pathname.split("/")[2] || "receivables";

  // Register the service worker if permission was already granted, and bridge
  // foreground pushes to in-app toasts — the SW suppresses the OS notification
  // while a window is focused so the user is never told the same thing twice.
  useEffect(() => {
    ensureServiceWorker();
    return onForegroundPush((payload) => {
      window.dispatchEvent(new CustomEvent("ledgerwatch:push", { detail: payload }));
    });
  }, []);

  return (
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
  );
}
