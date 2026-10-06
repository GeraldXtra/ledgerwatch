import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { Suspense, lazy } from "react";
import LandingPage from "./pages/LandingPage";
import AuthPage from "./pages/AuthPage";
import Dashboard from "./pages/Dashboard";
import ReceivablesPage from "./features/receivables/ReceivablesPage";

const WalletPage = lazy(() => import("./features/wallet/WalletPage"));

const MarketWatchPage = lazy(() => import("./features/market/MarketWatchPage"));

const SettingsPage = lazy(() => import("./pages/Settings"));
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

function PublicOnly({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <Booting />;
  return user ? <Navigate to="/app" replace /> : children;
}

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
        <Route path="/docs" element={<Public><DocsPage /></Public>} />
        <Route path="/docs/:slug" element={<Public><DocsPage /></Public>} />
        <Route path="/privacy" element={<Public><LegalPage which="privacy" /></Public>} />
        <Route path="/terms" element={<Public><LegalPage which="terms" /></Public>} />
        <Route path="/contact" element={<Public><ContactPage /></Public>} />
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
