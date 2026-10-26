import { Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { NavLink, Outlet, Link, useLocation, useNavigate } from "react-router-dom";
import { BookOpen, LogOut, Menu } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { Avatar, Footer, ToastProvider, useToast } from "../components/ui";
import Breadcrumbs from "../components/ui/Breadcrumbs";
import { TrailProvider, WorkspaceProvider, useWorkspace } from "../components/ui/Modal";
import LogoMark from "../components/LogoMark";
import ThemeToggle from "../components/ThemeToggle";
import { ensureServiceWorker, onForegroundPush, releaseDeviceOnSignOut, syncPush } from "../api/push";
import { nativePushAvailable, onNativeMessage, startNativeListening } from "../api/nativePush";

const NAV_ITEMS = [
  { id: "receivables", label: "Receivables", to: "/app/receivables" },
  { id: "market", label: "Market Watch", to: "/app/market" },
  { id: "wallet", label: "Wallet", to: "/app/wallet" },
  { id: "settings", label: "Settings", to: "/app/settings" },
];

const VIEWS = {
  receivables: [
    { id: "overview", label: "Overview" },
    { id: "debts", label: "Debts" },
    { id: "debtors", label: "Debtors" },
  ],
  market: [
    { id: "alerts", label: "Alerts" },
    { id: "watchlist", label: "Watchlist" },
    { id: "portfolio", label: "Portfolio" },
  ],
};

const PARENT = {
  receivables: {
    debt: "debts",
    record: "debts",
    edit: "debts",
    reminder: "debts",
    crypto: "debts",
    sweep: "debts",
    debtor: "debtors",
    statement: "debtors",
  },
  market: {
    buy: "alerts",
    sell: "alerts",
    swap: "alerts",
    coin: "watchlist",
    watch: "watchlist",
  },
};

const PAGE_PARAMS = ["step"];

function sectionOf(pathname) {
  const id = pathname.replace(/^\/app\/?/, "").split("/")[0];
  return NAV_ITEMS.find((n) => n.id === id) || NAV_ITEMS[0];
}

function viewOf(sectionId, search) {
  const views = VIEWS[sectionId];
  if (!views) return null;
  const wanted = new URLSearchParams(search).get("view");
  const mapped = (PARENT[sectionId] && PARENT[sectionId][wanted]) || wanted;
  return views.find((v) => v.id === mapped) || views[0];
}

function listSearch(sectionId, search) {
  const p = new URLSearchParams(search);
  PAGE_PARAMS.forEach((k) => p.delete(k));
  const wanted = p.get("view");
  const views = VIEWS[sectionId];
  if (wanted && !(views && views.some((v) => v.id === wanted))) {
    const parent = PARENT[sectionId] && PARENT[sectionId][wanted];
    if (parent) p.set("view", parent);
    else p.delete("view");
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

function pageSearch(entry, base) {
  const p = new URLSearchParams(base);
  PAGE_PARAMS.forEach((k) => p.delete(k));
  p.set("view", entry.view);
  if (entry.paramsKey) {
    Object.entries(JSON.parse(entry.paramsKey)).forEach(([k, v]) => p.set(k, String(v)));
  }
  return `?${p.toString()}`;
}

function depthOf(location) {
  return (location.state && location.state.lwDepth) || 0;
}

function PushBridge() {
  const toast = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    if (nativePushAvailable()) {
      const stopListening = startNativeListening();
      const stopMessages = onNativeMessage((message) => {
        if (message.kind === "push") {
          const payload = message.payload || {};
          toast(payload.title ? `${payload.title}. ${payload.body || ""}`.trim() : payload.body || "", {
            type: payload.type === "alert" ? "info" : "success",
          });
          window.dispatchEvent(new CustomEvent("ledgerwatch:push", { detail: payload }));
        } else if (message.kind === "open") {
          const url = (message.payload && message.payload.url) || "/app";
          if (url.startsWith("/app")) navigate(url);
        }
      });
      syncPush({ force: true });
      const onVisibleNative = () => {
        if (document.visibilityState === "visible") syncPush();
      };
      document.addEventListener("visibilitychange", onVisibleNative);
      return () => {
        document.removeEventListener("visibilitychange", onVisibleNative);
        stopMessages();
        stopListening();
      };
    }

    ensureServiceWorker().then(() => syncPush({ force: true }));
    const onVisible = () => {
      if (document.visibilityState === "visible") syncPush();
    };
    document.addEventListener("visibilitychange", onVisible);

    const stop = onForegroundPush((message) => {
      if (message.kind === "resubscribed") {
        syncPush({ force: true });
        return;
      }

      if (message.kind === "push") {
        const payload = message.payload || {};
        if (!message.shown) {
          toast(
            payload.title ? `${payload.title}. ${payload.body || ""}`.trim() : payload.body || "",
            { type: payload.type === "alert" ? "info" : "success" }
          );
        }
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
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      stop();
    };
  }, [toast, navigate]);

  return null;
}

function SideNav({ section, view }) {
  return (
    <>
      <Link to="/app/receivables" className="aw-nav-head">
        LedgerWatch
      </Link>
      {NAV_ITEMS.slice(0, 2).map((s) => (
        <div key={s.id} className="aw-nav-group" role="group" aria-labelledby={`aw-grp-${s.id}`}>
          <p className="aw-grp" id={`aw-grp-${s.id}`}>
            {s.label}
          </p>
          {VIEWS[s.id].map((v) => (
            <Link
              key={v.id}
              to={`${s.to}?view=${v.id}`}
              aria-current={section.id === s.id && view && view.id === v.id ? "page" : undefined}
            >
              {v.label}
            </Link>
          ))}
        </div>
      ))}
      <div className="aw-nav-group" role="group" aria-labelledby="aw-grp-account">
        <p className="aw-grp" id="aw-grp-account">Account</p>
        {NAV_ITEMS.slice(2).map(({ id, label, to }) => (
          <NavLink key={id} to={to}>
            {label}
          </NavLink>
        ))}
      </div>
      <hr className="aw-hr" />
      <Link to="/docs">Guide</Link>
      <Link to="/contact">Contact</Link>
    </>
  );
}

function useUrlPages(ws, location, navigate) {
  const entries = ws.entries;
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const locRef = useRef(location);
  locRef.current = location;
  const section = sectionOf(location.pathname);
  const baseRef = useRef(listSearch(section.id, location.search));
  if (entries.length === 0 && depthOf(location) === 0) {
    baseRef.current = listSearch(section.id, location.search);
  }

  useEffect(() => {
    const list = entriesRef.current;
    const d = depthOf(location);
    const sectionId = sectionOf(location.pathname).id;
    if (d < list.length) {
      list
        .slice(d)
        .reverse()
        .forEach((e) => e.back());
      const t = setTimeout(() => {
        const now = entriesRef.current;
        const loc = locRef.current;
        const dn = depthOf(loc);
        for (let i = dn; i < now.length; i++) {
          navigate(
            { pathname: loc.pathname, search: pageSearch(now[i], baseRef.current) },
            { state: { lwDepth: i + 1 } }
          );
        }
      }, 80);
      return () => clearTimeout(t);
    }
    if (d > list.length || (list.length === 0 && listSearch(sectionId, location.search) !== location.search)) {
      const top = list[list.length - 1];
      navigate(
        {
          pathname: location.pathname,
          search: top
            ? pageSearch(top, baseRef.current)
            : listSearch(sectionId, location.search),
        },
        { replace: true, state: list.length ? { lwDepth: list.length } : null }
      );
    }
    return undefined;
  }, [location, navigate]);

  const prevRef = useRef(entries);
  useEffect(() => {
    if (prevRef.current === entries) return;
    prevRef.current = entries;
    const loc = locRef.current;
    const d = depthOf(loc);
    const n = entries.length;
    if (n > d) {
      for (let i = d; i < n; i++) {
        navigate(
          { pathname: loc.pathname, search: pageSearch(entries[i], baseRef.current) },
          { state: { lwDepth: i + 1 } }
        );
      }
    } else if (n < d) {
      navigate(-(d - n));
    } else if (n > 0) {
      const want = pageSearch(entries[n - 1], baseRef.current);
      if (want !== loc.search) {
        navigate({ pathname: loc.pathname, search: want }, { replace: true, state: { lwDepth: n } });
      }
    }
  }, [entries, navigate]);

  return baseRef.current;
}

function useScrollMemory(entries) {
  const stackRef = useRef([]);
  const prevRef = useRef({ n: 0, top: null });
  const top = entries[entries.length - 1] || null;

  useLayoutEffect(() => {
    const n = entries.length;
    const prev = prevRef.current;
    if (n > prev.n) {
      for (let i = prev.n; i < n; i++) stackRef.current[i] = window.scrollY;
      window.scrollTo(0, 0);
    } else if (n < prev.n) {
      const y = stackRef.current[n] || 0;
      stackRef.current.length = n;
      window.scrollTo(0, y);
    } else if (top && prev.top && top.id !== prev.top.id) {
      window.scrollTo(0, 0);
    }
    prevRef.current = { n, top };
  }, [entries, top]);
}

function Workspace() {
  const { user, logout } = useAuth();
  const signOut = () =>
    Promise.race([releaseDeviceOnSignOut(), new Promise((resolve) => setTimeout(resolve, 3000))]).finally(logout);
  const location = useLocation();
  const navigate = useNavigate();
  const ws = useWorkspace();
  const [navOpen, setNavOpen] = useState(false);
  const menuRef = useRef(null);
  const navRef = useRef(null);

  const base = useUrlPages(ws, location, navigate);
  useScrollMemory(ws.entries);

  const section = sectionOf(location.pathname);
  const view = viewOf(section.id, ws.entries.length ? base : location.search);
  const open = ws.entries.length > 0;

  const listTrail = [{ label: "LedgerWatch", to: "/app/receivables" }];
  if (view) {
    listTrail.push({ label: section.label, to: `${section.to}?view=${VIEWS[section.id][0].id}` });
    listTrail.push({ label: view.label, to: `${section.to}?view=${view.id}` });
  } else {
    listTrail.push({ label: section.label, to: `${section.to}${base}` });
  }

  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (!navOpen) return undefined;
    const first = navRef.current && navRef.current.querySelector("a");
    if (first) first.focus();
    function onKey(e) {
      if (e.key === "Escape") {
        setNavOpen(false);
        if (menuRef.current) menuRef.current.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    const body = document.body;
    const scrollY = window.scrollY;
    const previous = { position: body.style.position, top: body.style.top, width: body.style.width, overflow: body.style.overflow };
    body.classList.add("aw-nav-open");
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.width = "100%";
    body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      body.classList.remove("aw-nav-open");
      body.style.position = previous.position;
      body.style.top = previous.top;
      body.style.width = previous.width;
      body.style.overflow = previous.overflow;
      window.scrollTo(0, scrollY);
    };
  }, [navOpen]);

  return (
    <div className="aw-app">
      <header className="aw-top">
        <button
          type="button"
          className="aw-icon aw-burger"
          aria-label="Menu"
          aria-controls="aw-nav"
          aria-expanded={navOpen}
          ref={menuRef}
          onClick={() => setNavOpen((o) => !o)}
        >
          <Menu size={20} aria-hidden="true" />
        </button>
        <NavLink to="/app/receivables" className="aw-brand" aria-label="LedgerWatch home">
          <LogoMark size={26} />
          <span className="brand-name">
            Ledger<em>Watch</em>
          </span>
        </NavLink>
        <div className="aw-top-r">
          <Link to="/docs" className="aw-icon aw-help" title="Help and documentation" aria-label="Help">
            <BookOpen size={18} />
          </Link>
          <ThemeToggle className="aw-icon" />
          <NavLink to="/app/settings" className="aw-acct" title="Your account" aria-label="Your account">
            <Avatar name={user.name} src={user.avatarUrl} />
            <span>{user.name}</span>
          </NavLink>
          <button type="button" className="aw-icon" onClick={signOut} title="Sign out" aria-label="Sign out">
            <LogOut size={18} />
          </button>
        </div>
      </header>

      <div className="aw">
        <nav className={navOpen ? "aw-nav show" : "aw-nav"} id="aw-nav" aria-label="Sections" ref={navRef}>
          <SideNav section={section} view={view} />
        </nav>
        {navOpen && (
          <div className="aw-scrim" aria-hidden="true" onClick={() => setNavOpen(false)} />
        )}

        <main className="aw-main">
          <TrailProvider trail={listTrail}>
            <div className="aw-view" hidden={open}>
              <Breadcrumbs items={listTrail} />
              <Suspense fallback={<p className="fallback-text">Loading this section...</p>}>
                <Outlet />
              </Suspense>
            </div>
          </TrailProvider>
          <div className="aw-pages" ref={ws.setPane} />
          <Footer />
        </main>
      </div>
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
