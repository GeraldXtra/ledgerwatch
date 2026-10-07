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
        <div className="lb" aria-hidden="true">
          <div className="lb-book">
            <i className="lb-base l" />
            <i className="lb-base r" />
            <div className="lb-page ruled">
              <i className="lb-hd" />
              <i className="lb-col" />
              <i className="w w1" />
              <i className="a a1" />
              <i className="w w2" />
              <i className="a a2" />
              <i className="w w3" />
              <i className="a a3" />
              <i className="lb-tot" />
              <svg className="lb-tick" viewBox="0 0 24 24">
                <path d="M4 12.5l5 5L20 6" />
              </svg>
            </div>
            <div className="lb-leaf p2">
              <i className="f" />
              <i className="b ruled">
                <i className="s s1" />
                <i className="s s2" />
                <i className="s s3" />
                <i className="s s4" />
              </i>
            </div>
            <div className="lb-leaf p1">
              <i className="f" />
              <i className="b ruled" />
            </div>
            <div className="lb-cover">
              <i className="f">
                <svg viewBox="9.5 4.5 40 51" fill="none">
                  <path d="M17.5 5.2v49.6" stroke="var(--brand-ink)" strokeWidth="2" />
                  <path
                    d="M11 14.5h5M11 30h5M11 45.5h5"
                    stroke="var(--brand-ink)"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                  />
                  <path
                    d="M41.5 5.7h3.8a3 3 0 0 1 3 3v3.8z M48.3 46.5v3.8a3 3 0 0 1-3 3h-3.8z"
                    fill="var(--brand-ink)"
                  />
                  <circle
                    cx="33.5"
                    cy="28.5"
                    r="10.3"
                    fill="var(--brand-face)"
                    stroke="var(--brand-ink)"
                    strokeWidth="2"
                  />
                  <path
                    d="M33.5 20.7v1.8M41.3 28.5h-1.8M33.5 36.3v-1.8M25.7 28.5h1.8"
                    stroke="var(--brand-ink)"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                  <path
                    d="M33.5 28.5l-4.3-3.1M33.5 28.5l5.4-3.9"
                    stroke="var(--brand-ink)"
                    strokeWidth="1.9"
                    strokeLinecap="round"
                  />
                  <circle
                    cx="33.5"
                    cy="28.5"
                    r="1.6"
                    fill="var(--brand-cover)"
                    stroke="var(--brand-ink)"
                    strokeWidth=".9"
                  />
                  <rect x="32" y="15.5" width="3" height="2.8" rx=".8" fill="var(--brand-ink)" />
                  <rect
                    x="26.5"
                    y="44"
                    width="14"
                    height="5.2"
                    rx="1.4"
                    fill="var(--brand-paper)"
                    stroke="var(--brand-ink)"
                    strokeWidth="1.5"
                  />
                </svg>
              </i>
              <i className="b" />
            </div>
          </div>
        </div>
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
