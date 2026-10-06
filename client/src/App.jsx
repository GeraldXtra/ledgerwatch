import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { Suspense, lazy } from "react";
import LandingPage from "./pages/LandingPage";
import AuthPage from "./pages/AuthPage";
import Dashboard from "./pages/Dashboard";
import ReceivablesPage from "./features/receivables/ReceivablesPage";

// Wallet pulls in ethers + qrcode — code-split so those load only on demand.
const WalletPage = lazy(() => import("./features/wallet/WalletPage"));

/**
 * MARKET WATCH IS SPLIT TOO. (LW-046, BUILD_PLAN P7-3.)
 *
 * It was the last large static import, and it is the heaviest thing in the app
 * after the wallet: recharts for the charts, ethers and the whole DEX layer for
 * live trading, the quoter and the router encoding. All of that was in the main
 * chunk, so it was downloaded by every visitor to the FRONT PAGE — before
 * signing in, and whether or not they ever open Market Watch.
 *
 * Receivables stays static on purpose: it is the app's default route
 * (`/app/*` redirects to it), so splitting it would only add a round trip
 * before the first screen anybody sees.
 */
const MarketWatchPage = lazy(() => import("./features/market/MarketWatchPage"));

/**
 * Settings too: it reaches into the keystore for the backup and reveal panels,
 * and carries the avatar cropper. Nobody lands on it, so nothing is lost by
 * fetching it when it is opened.
 */
const SettingsPage = lazy(() => import("./pages/Settings"));
// The guide, the policy pages and the contact form carry a lot of text that
// the app itself never needs. Split, so signing in does not download it.
const DocsPage = lazy(() => import("./pages/DocsPage"));
const LegalPage = lazy(() => import("./pages/LegalPage"));
const ContactPage = lazy(() => import("./pages/ContactPage"));

function Booting() {
  return (
    <div className="center-screen boot" aria-busy="true">
      <div className="boot-inner">
        <svg className="boot-mark" viewBox="0 0 64 64" fill="none" aria-hidden="true">
          <rect className="boot-sq" width="64" height="64" rx="16" />
          <g transform="translate(32 32.4) scale(.74) translate(-32 -32.4)">
            <path className="boot-rule boot-r1" d="M14 44H50" strokeWidth="5.5" />
            <path className="boot-rule boot-r2" d="M14 52H50" strokeWidth="5.5" />
            <path
              className="boot-tick"
              d="M18 25L27.5 34.5L46 14"
              strokeWidth="8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
        </svg>
        <div className="wordmark boot-word">
          Ledger<span className="tick">Watch</span>
        </div>
        <p className="boot-text">Loading your workspace...</p>
      </div>
    </div>
  );
}

/** Signed-in users skip the public pages and land in the app. */
function PublicOnly({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <Booting />;
  return user ? <Navigate to="/app" replace /> : children;
}

/** A code-split public page. The wait is a moment, so the fallback is quiet:
    a reader of the guide has no "workspace" to load. */
function Public({ children }) {
  return (
    <Suspense
      fallback={
        <div className="center-screen">
          <p className="fallback-text">Loading...</p>
        </div>
      }
    >
      {children}
    </Suspense>
  );
}

/** The dashboard requires a session. */
function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <Booting />;
  return user ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route
          path="/"
          element={
            <PublicOnly>
              <LandingPage />
            </PublicOnly>
          }
        />
        <Route
          path="/login"
          element={
            <PublicOnly>
              <AuthPage />
            </PublicOnly>
          }
        />
        {/* The user guide. Public, so someone deciding whether to sign up can
            read how the product works, and reachable signed in, from the Help
            icon and the footer. */}
        <Route path="/docs" element={<Public><DocsPage /></Public>} />
        <Route path="/docs/:slug" element={<Public><DocsPage /></Public>} />
        {/* The policy, the terms and the contact form. Public for the same
            reason as the guide, and reachable from every footer. */}
        <Route path="/privacy" element={<Public><LegalPage which="privacy" /></Public>} />
        <Route path="/terms" element={<Public><LegalPage which="terms" /></Public>} />
        <Route path="/contact" element={<Public><ContactPage /></Public>} />
        {/* The shell renders sidebar + topbar and an <Outlet> for the section, so
            each tab gets a real shareable URL and /app/settings can exist. Each
            page's own data flow is unchanged. */}
        <Route
          path="/app"
          element={
            <RequireAuth>
              <Dashboard />
            </RequireAuth>
          }
        >
          <Route index element={<Navigate to="/app/receivables" replace />} />
          <Route path="receivables" element={<ReceivablesPage />} />
          <Route path="market" element={<MarketWatchPage />} />
          <Route path="wallet" element={<WalletPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/app/receivables" replace />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
