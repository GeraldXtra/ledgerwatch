/**
 * Light and dark, as one attribute on the root element.
 *
 * The stylesheet defines every colour as a token on `:root`, and redefines the
 * tokens under `:root[data-theme="dark"]`. So switching theme is switching that
 * attribute and nothing else; no component knows which theme it is in.
 *
 * The choice is remembered per browser. With no choice recorded, the system
 * preference decides, so a phone in dark mode opens the app in dark mode
 * without being asked. The inline script in index.html applies the same rule
 * before the first paint, which is what stops a light flash on a dark page.
 */

const KEY = "ledgerwatch.theme";
const EVENT = "ledgerwatch:theme";

export function storedTheme() {
  try {
    const t = localStorage.getItem(KEY);
    return t === "dark" || t === "light" ? t : null;
  } catch {
    return null;
  }
}

export function systemTheme() {
  return typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function currentTheme() {
  return storedTheme() || systemTheme();
}

export function applyTheme(theme) {
  const t = theme === "dark" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", t);
  // The browser chrome on a phone follows this, so it should agree with the page.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", t === "dark" ? "#0f1216" : "#16283f");
}

export function setTheme(theme) {
  try {
    localStorage.setItem(KEY, theme === "dark" ? "dark" : "light");
  } catch {
    /* private mode: the choice lasts for this page only */
  }
  applyTheme(theme);
  window.dispatchEvent(new Event(EVENT));
}

export function toggleTheme() {
  setTheme(currentTheme() === "dark" ? "light" : "dark");
}

/** Subscribe to theme changes. Returns an unsubscribe function. */
export function onThemeChange(fn) {
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
}
