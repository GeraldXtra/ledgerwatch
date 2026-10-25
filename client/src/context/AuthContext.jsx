import { createContext, useContext, useEffect, useState, useCallback } from "react";
import http, { getToken, setToken } from "../api/http";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [authUnreachable, setAuthUnreachable] = useState(false);
  const [loading, setLoading] = useState(true);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

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

  useEffect(() => {
    const onUnauthorized = () => setUser(null);
    window.addEventListener("ledgerwatch:unauthorized", onUnauthorized);
    return () =>
      window.removeEventListener("ledgerwatch:unauthorized", onUnauthorized);
  }, []);

  const login = useCallback(async (email, password, turnstileToken) => {
    const { data } = await http.post("/api/auth/login", { email, password, turnstileToken });
    if (data.twoFactorRequired) return { twoFactorRequired: true, challenge: data.challenge };
    setToken(data.token);
    setUser(data.user);
    return data.user;
  }, []);

  const loginSecondFactor = useCallback(async (challenge, code) => {
    const { data } = await http.post("/api/auth/login/2fa", { challenge, code });
    setToken(data.token);
    setUser(data.user);
    return data;
  }, []);

  const applySession = useCallback((token, nextUser) => {
    setToken(token);
    if (nextUser) setUser(nextUser);
  }, []);

  const register = useCallback(async (payload) => {
    const { data } = await http.post("/api/auth/register", payload);
    return data;
  }, []);

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

  const applyUser = useCallback((next) => setUser(next), []);

  const refreshUser = useCallback(async () => {
    try {
      const { data } = await http.get("/api/auth/me");
      setUser(data.user);
      return data.user;
    } catch {
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
    loginSecondFactor,
    applySession,
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
