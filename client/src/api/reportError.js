import { API_BASE } from "./base";

const MAX_REPORTS = 5;
const reported = new Set();

function safePath(pathname) {
  return String(pathname || "/")
    .split("/")
    .map((part) => (part.length > 20 && /^[A-Za-z0-9_.-]+$/.test(part) ? ":id" : part))
    .join("/")
    .slice(0, 300);
}

function describe(error) {
  if (!error) return "Unknown error";
  if (typeof error === "string") return error;
  return String(error.message || error.reason || error);
}

export function reportError(kind, error) {
  if (!import.meta.env.PROD || !API_BASE || reported.size >= MAX_REPORTS) return;
  const message = describe(error).slice(0, 1000);
  const key = `${kind}:${message}`;
  if (reported.has(key)) return;
  reported.add(key);
  const body = JSON.stringify({
    kind,
    message,
    stack: String((error && error.stack) || "").slice(0, 4000),
    page: safePath(window.location.pathname),
  });
  fetch(`${API_BASE}/api/client-errors`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch((err) => console.warn("[errors] the report could not be sent:", err && err.message));
}

export function installErrorReporting() {
  window.addEventListener("error", (event) => {
    if (!event.error && !event.message) return;
    reportError("error", event.error || event.message);
  });
  window.addEventListener("unhandledrejection", (event) => reportError("rejection", event.reason));
}
