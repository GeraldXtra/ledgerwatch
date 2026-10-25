const configured = String(import.meta.env.VITE_API_URL || "").trim().replace(/\/+$/, "");

export const API_BASE = configured || (import.meta.env.DEV ? "http://localhost:8000" : "");

export const API_MISSING = !API_BASE;
