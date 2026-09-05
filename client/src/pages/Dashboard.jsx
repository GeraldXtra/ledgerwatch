import { Suspense, useEffect } from "react";
import { NavLink, Outlet, Link } from "react-router-dom";
import {
  Receipt,
  CandlestickChart,
  Wallet,
  Settings as SettingsIcon,
  LogOut,
  BookOpen,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { Avatar, Footer, ToastProvider, useToast } from "../components/ui";
import LogoMark from "../components/LogoMark";
import ThemeToggle from "../components/ThemeToggle";
import { ensureServiceWorker, onForegroundPush } from "../api/push";

/**
 * THE SHELL
 *
 * A white bar across the top: the brand, the four sections, and on the right
 * the account, the theme, help and sign out. The page sits under it in a
 * centred column on a light ground. On a phone the four sections move to a
 * bar along the bottom of the screen, where a thumb can reach them.
 *
 * This replaced a serif masthead over a double rule with a sliding underscore
 * in the navigation. Users said the interface was too much. The shell now
 * says where you are and where you can go, and nothing else.
 */

const NAV_ITEMS = [
  { id: "receivables", label: "Receivables", icon: Receipt, to: "/app/receivables" },
  { id: "market", label: "Market Watch", icon: CandlestickChart, to: "/app/market" },
  { id: "wallet", label: "Wallet", icon: Wallet, to: "/app/wallet" },
  { id: "settings", label: "Settings", icon: SettingsIcon, to: "/app/settings" },
];

/**
 * The single foreground push bridge for the whole app. It lives in the shell
 * because the service worker suppresses the OS notification whenever a window
 * is focused and has no idea which route the user is on.
 */
function PushBridge() {
  const toast = useToast();

  useEffect(() => {
    ensureServiceWorker();

    return onForegroundPush((message) => {
      if (message.kind === "push") {
        const payload = message.payload || {};
        toast(
          payload.title ? `${payload.title}. ${payload.body || ""}`.trim() : payload.body || "",
          { type: payload.type === "alert" ? "info" : "success" }
        );
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

  return (
    <ToastProvider>
      <PushBridge />
      <div className="app">
        <header className="topbar">
          <div className="topbar-inner">
            <NavLink to="/app/receivables" className="brand" aria-label="LedgerWatch home">
              <LogoMark size={28} />
              <span className="brand-name">
                Ledger<em>Watch</em>
              </span>
            </NavLink>

            <nav className="topnav" aria-label="Sections">
              {NAV_ITEMS.map(({ id, label, icon: Icon, to }) => (
                <NavLink
                  key={id}
                  to={to}
                  className={({ isActive }) => (isActive ? "topnav-link active" : "topnav-link")}
                >
                  <Icon size={15} />
                  {label}
                </NavLink>
              ))}
            </nav>

            <div className="topbar-right">
              <NavLink to="/app/settings" className="topbar-user" title="Your account">
                <Avatar name={user.name} src={user.avatarUrl} />
                <span className="hide-sm">{user.name}</span>
              </NavLink>
              <Link to="/docs" className="topbar-icon" title="Help and documentation" aria-label="Help">
                <BookOpen size={16} />
              </Link>
              <ThemeToggle className="topbar-icon" />
              <button
                type="button"
                className="topbar-icon"
                onClick={logout}
                title="Sign out"
                aria-label="Sign out"
              >
                <LogOut size={16} />
              </button>
            </div>
          </div>
        </header>

        <main className="page">
          <Suspense fallback={<p className="muted">Loading this section...</p>}>
            <Outlet />
          </Suspense>
        </main>

        <Footer />

        {/* Phones only. The same four sections, along the bottom. */}
        <nav className="bottomnav" aria-label="Sections">
          {NAV_ITEMS.map(({ id, label, icon: Icon, to }) => (
            <NavLink
              key={id}
              to={to}
              className={({ isActive }) => (isActive ? "bottomnav-link active" : "bottomnav-link")}
            >
              <Icon size={20} />
              {label === "Market Watch" ? "Market" : label}
            </NavLink>
          ))}
        </nav>
      </div>
    </ToastProvider>
  );
}
