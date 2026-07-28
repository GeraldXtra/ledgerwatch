import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import LandingPage from "./pages/LandingPage";
import AuthPage from "./pages/AuthPage";
import Dashboard from "./pages/Dashboard";
import StylePreview from "./pages/StylePreview"; // TEMPORARY — remove with /style-preview
import LogoMark from "./components/LogoMark";

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
        <Route
          path="/app"
          element={
            <RequireAuth>
              <Dashboard />
            </RequireAuth>
          }
        />
        {/* TEMPORARY palette comparison. Unguarded so it opens signed in or out,
            and declared before the catch-all, which would otherwise bounce it
            to "/". Delete this route with the rebuild. */}
        <Route path="/style-preview" element={<StylePreview />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
