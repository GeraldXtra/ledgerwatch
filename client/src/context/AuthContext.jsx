import { createContext, useContext, useEffect, useState, useCallback } from "react";
import http, { getToken, setToken } from "../api/http";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  // True when the account could not be loaded for a reason that is NOT a
  // rejected session — the server being asleep or unreachable. The session is
  // kept; the app can say so rather than silently showing a signed-out screen.
  const [authUnreachable, setAuthUnreachable] = useState(false);
  const [loading, setLoading] = useState(true);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  // Rehydrate on load: if a token exists, fetch the current user.
  useEffect(() => {
    let active = true;
    async function rehydrate() {
      if (!getToken()) {
        setLoading(false);
        return;
      }
      try {
        const { data } = await http.get("/api/auth/me");
        if (active) setUser(data.user);
      } catch (err) {
        /**
         * ONLY A 401 MEANS THE SESSION IS OVER.
         *
         * This caught everything and called `logout()`, which discards the
         * stored token — so any failure to reach the server on page load signed
         * the user out and made them enter their password again. On this
         * deployment that is not an edge case: the server sleeps after about
         * fifteen minutes of inactivity and the first request then takes 30 to
         * 60 seconds, which is written down in DEPLOY_CHECKLIST.md as an
         * expected property of the host. A timeout, an offline moment or a 500
         * all read as "you are not signed in".
         *
         * A real 401 is already handled twice over: the axios interceptor
         * broadcasts `ledgerwatch:unauthorized`, and requireAuth returns 401 for
         * a bad or superseded token. Everything else leaves the token alone and
         * lets the next request try again.
         */
        const status = err?.response?.status;
        if (active) {
          if (status === 401) {
            logout();
          } else {
            setAuthUnreachable(true);
            console.error("[auth] could not load the account:", err?.message || err);
          }
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    rehydrate();
    return () => {
      active = false;
    };
  }, [logout]);

  // React to a 401 broadcast from the axios interceptor.
  useEffect(() => {
    const onUnauthorized = () => setUser(null);
    window.addEventListener("ledgerwatch:unauthorized", onUnauthorized);
    return () =>
      window.removeEventListener("ledgerwatch:unauthorized", onUnauthorized);
  }, []);

  const login = useCallback(async (email, password, turnstileToken) => {
    const { data } = await http.post("/api/auth/login", { email, password, turnstileToken });
    setToken(data.token);
    setUser(data.user);
    return data.user;
  }, []);

  /**
   * Registering no longer starts a session. The server creates the account
   * unverified and emails a code, so this returns the "confirm your email" state
   * for the form to act on. Signing somebody in here would make the verification
   * step decorative.
   */
  const register = useCallback(async (payload) => {
    const { data } = await http.post("/api/auth/register", payload);
    return data;
  }, []);

  /** Confirming the code IS the moment the session begins. */
  const verifyEmail = useCallback(async (email, code) => {
    const { data } = await http.post("/api/auth/verify-email", { email, code });
    setToken(data.token);
    setUser(data.user);
    return data.user;
  }, []);

  const resendCode = useCallback(async (email) => {
    const { data } = await http.post("/api/auth/resend-code", { email });
    return data;
  }, []);

  // ---- password reset: three calls, and none of them starts a session ----
  const forgotPassword = useCallback(async (email, turnstileToken) => {
    const { data } = await http.post("/api/auth/forgot-password", { email, turnstileToken });
    return data;
  }, []);

  const resendResetCode = useCallback(async (email) => {
    const { data } = await http.post("/api/auth/resend-reset-code", { email });
    return data;
  }, []);

  const resetPassword = useCallback(async (email, code, newPassword) => {
    const { data } = await http.post("/api/auth/reset-password", { email, code, newPassword });
    return data;
  }, []);

  /**
   * Sign in with Google ends with a token in the URL fragment. This turns it
   * into a session by storing it and loading the account behind it. If that
   * load fails the token is discarded rather than left in storage pointing at
   * nothing.
   */
  const loginWithToken = useCallback(async (token) => {
    setToken(token);
    try {
      const { data } = await http.get("/api/auth/me");
      setUser(data.user);
      return data.user;
    } catch (err) {
      setToken(null);
      throw err;
    }
  }, []);

  const updateProfile = useCallback(async (updates) => {
    const { data } = await http.patch("/api/auth/me", updates);
    setUser(data.user);
    return data.user;
  }, []);

  // Push a user returned by any OTHER endpoint (avatar upload/removal) into
  // context, so the sidebar and topbar update without a refetch.
  const applyUser = useCallback((next) => setUser(next), []);

  /**
   * Re-read the account from the server.
   *
   * Needed by anything that changes the user record through an endpoint that
   * does not return the whole user — adding a token after a live buy, for one.
   * Without it the new token sits in the database and the interface keeps
   * rendering the list it loaded at sign-in, so the asset stays invisible until
   * a reload, which is the same symptom as not having saved it at all.
   */
  const refreshUser = useCallback(async () => {
    try {
      const { data } = await http.get("/api/auth/me");
      setUser(data.user);
      return data.user;
    } catch {
      // A failed refresh leaves the previous user in place, which is correct:
      // the change was saved server-side either way, and signing somebody out
      // over a stale sidebar would be far worse.
      return null;
    }
  }, []);

  const value = {
    user,
    loading,
    login,
    register,
    verifyEmail,
    resendCode,
    forgotPassword,
    resendResetCode,
    resetPassword,
    loginWithToken,
    logout,
    updateProfile,
    applyUser,
    refreshUser,
    authUnreachable,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
