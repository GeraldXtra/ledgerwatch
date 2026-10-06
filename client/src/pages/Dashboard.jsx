import { Suspense, useEffect, useRef } from "react";
import { NavLink, Outlet, Link, useLocation } from "react-router-dom";
import {
  BellRing,
  BookOpen,
  CandlestickChart,
  ChevronLeft,
  FlaskConical,
  LayoutDashboard,
  LogOut,
  Receipt,
  Settings as SettingsIcon,
  Users,
  Wallet,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { Avatar, Footer, ToastProvider, useToast } from "../components/ui";
import { WorkspaceProvider, useWorkspace } from "../components/ui/Modal";
import LogoMark from "../components/LogoMark";
import ThemeToggle from "../components/ThemeToggle";
import { ensureServiceWorker, onForegroundPush } from "../api/push";

const NAV_ITEMS = [
  { id: "receivables", label: "Receivables", icon: Receipt, to: "/app/receivables" },
  { id: "market", label: "Market Watch", icon: CandlestickChart, to: "/app/market" },
  { id: "wallet", label: "Wallet", icon: Wallet, to: "/app/wallet" },
  { id: "settings", label: "Settings", icon: SettingsIcon, to: "/app/settings" },
];

const VIEWS = {
  receivables: [
    { id: "overview", label: "Overview", icon: LayoutDashboard, wide: true },
    { id: "debts", label: "Debts", icon: Receipt },
    { id: "debtors", label: "Debtors", icon: Users },
  ],
  market: [
    { id: "alerts", label: "Alerts", icon: BellRing },
    { id: "watchlist", label: "Watchlist", icon: CandlestickChart },
    { id: "portfolio", label: "Portfolio", icon: FlaskConical, wide: true },
  ],
};

function sectionOf(pathname) {
  const id = pathname.replace(/^\/app\/?/, "").split("/")[0];
  return NAV_ITEMS.find((n) => n.id === id) || NAV_ITEMS[0];
}

function viewOf(sectionId, search) {
  const views = VIEWS[sectionId];
  if (!views) return null;
  const wanted = new URLSearchParams(search).get("view");
  return views.find((v) => v.id === wanted) || views[0];
}

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

function ViewLink({ section, view, current, children, className }) {
  return (
    <Link
      to={`${section.to}?view=${view.id}`}
      className={className}
      aria-current={current ? "page" : undefined}
    >
      {children}
    </Link>
  );
}

function SideNav({ section, view }) {
  return (
    <>
      {NAV_ITEMS.slice(0, 2).map((s) => (
        <div key={s.id}>
          <p className="ws-grp">{s.label}</p>
          <nav className="ws-nav" aria-label={s.label}>
            {VIEWS[s.id].map((v) => {
              const Icon = v.icon;
              return (
                <ViewLink
                  key={v.id}
                  section={s}
                  view={v}
                  current={section.id === s.id && view && view.id === v.id}
                >
                  <Icon size={18} aria-hidden="true" />
                  <span>{v.label}</span>
                </ViewLink>
              );
            })}
          </nav>
        </div>
      ))}
      <p className="ws-grp">Account</p>
      <nav className="ws-nav" aria-label="Account">
        {NAV_ITEMS.slice(2).map(({ id, label, icon: Icon, to }) => (
          <NavLink key={id} to={to}>
            <Icon size={18} aria-hidden="true" />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </>
  );
}

function Workspace() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const ws = useWorkspace();
  const detailRef = useRef(null);

  const section = sectionOf(location.pathname);
  const view = viewOf(section.id, location.search);
  const views = VIEWS[section.id] || null;
  const listName = view ? view.label : section.label;

  const entries = ws.entries;
  const top = entries[entries.length - 1] || null;
  const phoneDetail = Boolean(top && top.screen === "screen");
  const inline = Boolean(top && top.screen === "inline");
  const wide = Boolean(view && view.wide);

  useEffect(() => {
    if (detailRef.current) detailRef.current.scrollTop = 0;
    if (
      phoneDetail &&
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(max-width: 899px)").matches
    ) {
      window.scrollTo(0, 0);
    }
  }, [top, phoneDetail]);

  return (
    <div
      className={wide ? "ws wide" : "ws"}
      data-view={phoneDetail ? "detail" : "list"}
      data-inline={inline ? "" : undefined}
      data-open={top ? "" : undefined}
    >
      <aside className="ws-side">
        <NavLink to="/app/receivables" className="ws-brand" aria-label="LedgerWatch home">
          <LogoMark size={24} />
          <span className="brand-name">
            Ledger<em>Watch</em>
          </span>
        </NavLink>

        <SideNav section={section} view={view} />

        <div className="ws-me">
          <NavLink to="/app/settings" className="ws-account" title="Your account" aria-label="Your account">
            <Avatar name={user.name} src={user.avatarUrl} />
            <span>{user.name}</span>
          </NavLink>
          <Link to="/docs" className="ws-icon" title="Help and documentation" aria-label="Help">
            <BookOpen size={17} />
          </Link>
          <ThemeToggle className="ws-icon" />
          <button type="button" className="ws-icon" onClick={logout} title="Sign out" aria-label="Sign out">
            <LogOut size={17} />
          </button>
        </div>
      </aside>

      <header className="ws-mtop">
        <div className="ws-mtop-row">
          <NavLink to="/app/receivables" className="ws-mtop-brand" aria-label="LedgerWatch home">
            <LogoMark size={26} />
          </NavLink>
          <b>{section.label}</b>
          <Link to="/docs" className="ws-icon" title="Help and documentation" aria-label="Help">
            <BookOpen size={18} />
          </Link>
          <ThemeToggle className="ws-icon" />
          <button type="button" className="ws-icon" onClick={logout} title="Sign out" aria-label="Sign out">
            <LogOut size={18} />
          </button>
          <NavLink to="/app/settings" className="ws-mav" title="Your account" aria-label="Your account">
            <Avatar name={user.name} src={user.avatarUrl} />
          </NavLink>
        </div>
        {views && (
          <nav className="ws-subnav" aria-label={section.label}>
            {views.map((v) => (
              <ViewLink key={v.id} section={section} view={v} current={view && view.id === v.id}>
                {v.label}
              </ViewLink>
            ))}
          </nav>
        )}
      </header>

      <main className={wide ? "ws-main" : "ws-pane ws-list"}>
        <Suspense fallback={<p className="fallback-text">Loading this section...</p>}>
          <Outlet />
        </Suspense>
        <Footer />
      </main>

      <section className="ws-pane ws-detail" ref={detailRef}>
        {top && (
          <button type="button" className="ws-back" onClick={() => top.back()}>
            <ChevronLeft size={18} aria-hidden="true" />
            {listName}
          </button>
        )}
        <div className="ws-detail-body" ref={ws.setPane} />
        {!top && (
          <div className="ws-detail-empty" aria-hidden="true">
            <LogoMark size={40} />
          </div>
        )}
      </section>

      <nav className="ws-tabbar" aria-label="Sections">
        {NAV_ITEMS.map(({ id, label, icon: Icon, to }) => (
          <NavLink key={id} to={to}>
            <Icon size={21} aria-hidden="true" />
            <span>{label === "Market Watch" ? "Market" : label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

export default function Dashboard() {
  return (
    <ToastProvider>
      <PushBridge />
      <WorkspaceProvider>
        <Workspace />
      </WorkspaceProvider>
    </ToastProvider>
  );
}
