import { Suspense, useEffect, useMemo, useRef } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  Receipt,
  CandlestickChart,
  Wallet,
  Settings as SettingsIcon,
  LogOut,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { Avatar, Footer, ToastProvider, useToast } from "../components/ui";
import LogoMark from "../components/LogoMark";
import ThemeToggle from "../components/ThemeToggle";
import useSlidingIndicator from "../hooks/useSlidingIndicator";
import { ensureServiceWorker, onForegroundPush } from "../api/push";

/**
 * THE SHELL
 *
 * A masthead over a double rule, then a rail of small capitals with one brass
 * underscore that slides. There is no sidebar.
 *
 * That is a deliberate structural change rather than a restyle. A fixed 240px
 * sidebar spends a fifth of the screen restating four words the user already
 * knows, on an application whose whole job is showing rows of figures. Moving
 * navigation into the chrome gives every one of those rows the width back, and
 * the masthead over a ruled page is how a book of account has always been laid
 * out, which is what this product is.
 */

const NAV_ITEMS = [
  { id: "receivables", label: "Receivables", icon: <Receipt size={14} />, to: "/app/receivables" },
  { id: "market", label: "Market Watch", icon: <CandlestickChart size={14} />, to: "/app/market" },
  { id: "wallet", label: "Wallet", icon: <Wallet size={14} />, to: "/app/wallet" },
  { id: "settings", label: "Settings", icon: <SettingsIcon size={14} />, to: "/app/settings" },
];

/**
 * The single foreground push bridge for the whole app.
 *
 * It lives in the shell rather than on one page because the service worker
 * suppresses the OS notification whenever a window is focused, and it has no
 * idea which route the user happens to be on. When the only listener sat inside
 * MarketWatchPage, a push that arrived while the user was on Settings or Wallet
 * produced neither an OS notification nor a toast. It vanished.
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
        // Pages that want to react (refetch, open a panel) listen for this. It
        // carries a `handled` marker so the alert poll does not toast the same
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

/** A ledger page carries its date. One line, and it says this is a record. */
function today() {
  try {
    return new Date().toLocaleDateString(undefined, {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

export default function Dashboard() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const railRef = useRef(null);

  // Active section comes from the URL rather than local state, so every tab has
  // a real shareable address.
  const tab = location.pathname.split("/")[2] || "receivables";
  const bar = useSlidingIndicator(railRef, tab);
  const date = useMemo(today, []);

  return (
    // Shell level provider so a foreground push can toast on ANY route. Pages
    // that mount their own provider are unaffected, because useToast resolves to
    // the nearest one, which is still theirs.
    <ToastProvider>
      <PushBridge />
      <div className="lw-shell">
        {/* ONE STICKY ELEMENT, NOT TWO.
            The masthead and the rail were each `position: sticky; top: 0` as
            siblings. Two stickies pinned to the same offset do not stack: each
            one pins at 0 independently, so as soon as the page scrolled the rail
            came to rest UNDERNEATH the masthead and its links disappeared behind
            it. It was wrong at every width and worst on a phone, where the
            chrome is a bigger share of the screen and there is more scrolling.

            Wrapping them makes the chrome a single sticky block, so the rail can
            only ever sit below the masthead no matter how tall either becomes —
            at any breakpoint, in any font, in any language. The alternative,
            giving the rail `top: <masthead height>`, needs a magic number per
            breakpoint and breaks the moment the brand wraps or a font loads
            late. */}
        <div className="lw-chrome">
          <header className="lw-mast">
          <div className="lw-mast-inner">
            <NavLink to="/app/receivables" className="lw-brand">
              <LogoMark size={30} />
              <span className="lw-brand-name">
                Ledger<em>Watch</em>
              </span>
            </NavLink>

            <span className="lw-mast-spacer" />

            <span className="lw-mast-date">{date}</span>

            <NavLink to="/app/settings" className="lw-mast-user" title="Your account">
              <Avatar name={user.name} src={user.avatarUrl} />
              <span className="hide-sm">{user.name}</span>
            </NavLink>

            <ThemeToggle />

            <button
              type="button"
              className="lw-mast-icon"
              onClick={logout}
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut size={16} />
            </button>
          </div>
          <hr className="lw-rule" />
        </header>

        <nav className="lw-rail" aria-label="Sections">
          <div className="lw-rail-inner" ref={railRef}>
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.id}
                to={item.to}
                data-navitem={item.id}
                className={({ isActive }) => (isActive ? "lw-rail-link active" : "lw-rail-link")}
              >
                {item.icon}
                {item.label}
              </NavLink>
            ))}

            {bar && (
              <span
                className="lw-rail-ink"
                aria-hidden="true"
                style={{ transform: `translateX(${bar.left}px)`, width: bar.width }}
              />
            )}

            {/* NOTHING IS ASSERTED HERE ANY MORE, AND THAT IS THE POINT.
                This rail used to read "Testnet" on the wallet tab and "Simulated
                portfolio" on the market tab. Both were true when mainnet was
                disabled and paper was the only trading mode. Both became FALSE
                the day mainnet was switched on: the rail would have said
                "Testnet" in small capitals directly above a real balance on
                Ethereum, and "Simulated portfolio" above a live wallet.

                The shell cannot know either fact. The selected chain lives in
                WalletPage and the trading mode lives in MarketWatchPage, so
                anything stated here is a guess dressed as chrome, and a label
                that cannot know the truth must not assert it. Both screens say
                it themselves where they actually know: the wallet through its
                network pill, which styles a mainnet differently from a testnet,
                and the market through its mode toggle. */}
            </div>
          </nav>
        </div>

        {/* Keyed on the route so the entrance replays on navigation. */}
        <main key={tab} className="lw-body lw-stack">
          <Suspense fallback={<p className="muted">Loading this section...</p>}>
            <Outlet />
          </Suspense>
        </main>

        <Footer />
      </div>
    </ToastProvider>
  );
}
