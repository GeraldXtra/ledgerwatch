import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { lazy } from "react";
import LandingPage from "./pages/LandingPage";
import AuthPage from "./pages/AuthPage";
import Dashboard from "./pages/Dashboard";
import ReceivablesPage from "./features/receivables/ReceivablesPage";
import MarketWatchPage from "./features/market/MarketWatchPage";
import SettingsPage from "./pages/Settings";
import LogoMark from "./components/LogoMark";

// Wallet pulls in ethers + qrcode — code-split so those load only on demand.
const WalletPage = lazy(() => import("./features/wallet/WalletPage"));

function Booting() {
  return (
    <div className="center-screen">
      <div className="stack-sm" style={{ textAlign: "center" }}>
        <div className="row" style={{ justifyContent: "center" }}>
          <LogoMark size={34} />
        </div>
        <div className="wordmark">
          Ledger<span className="tick">Watch</span>
        </div>
        <p className="muted small">Loading your workspace...</p>
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
