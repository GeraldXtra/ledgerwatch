export const APP_RETURN_BASE = "co.useledgerwatch.app://login";

export function signInHashOf(url) {
  const s = String(url || "");
  const at = s.indexOf("#");
  return at >= 0 ? s.slice(at + 1) : "";
}

export function parseSignInHash(hash) {
  const raw = String(hash || "").replace(/^#/, "");
  if (!raw) return null;
  const params = new URLSearchParams(raw);
  const token = params.get("token") || "";
  const challenge = params.get("challenge") || "";
  const error = params.get("error") || "";
  if (!token && !challenge && !error) return null;
  return { token, challenge, error, nonce: params.get("n") || "", raw };
}

export function wantsAppReturn(search) {
  try {
    return new URLSearchParams(String(search || "")).get("return") === "app";
  } catch {
    return false;
  }
}

export function appReturnLink(hash) {
  const raw = String(hash || "").replace(/^#/, "");
  return raw ? `${APP_RETURN_BASE}#${raw}` : APP_RETURN_BASE;
}
