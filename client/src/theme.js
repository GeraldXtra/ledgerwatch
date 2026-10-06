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

/**
 * Subscribe to theme changes. Returns an unsubscribe function.
 *
 * THE SYSTEM SETTING IS A SOURCE OF CHANGE TOO, AND WAS NOT LISTENED TO.
 *
 * This watched only `ledgerwatch:theme`, which nothing but `setTheme` dispatches
 * — so with no stored choice the system preference was read exactly once, at
 * load. A phone that switched to dark at sunset with LedgerWatch open stayed
 * light until the page was reloaded, which is the commoner case and the one the
 * docstring at the top of this file claims to handle.
 *
 * An explicit choice still wins: the media listener does nothing while
 * `storedTheme()` has a value, so switching the device does not undo a theme the
 * owner picked.
 */
export function onThemeChange(fn) {
  window.addEventListener(EVENT, fn);

  let media = null;
  const onSystem = () => {
    if (storedTheme()) return;
    applyTheme(systemTheme());
    fn();
  };
  try {
    media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", onSystem);
  } catch {
    // No matchMedia, or a browser too old for addEventListener on the list.
    // Following the system live is a convenience; the toggle still works.
    media = null;
  }

  return () => {
    window.removeEventListener(EVENT, fn);
    if (media) {
      try {
        media.removeEventListener("change", onSystem);
      } catch {
        /* nothing to detach */
      }
    }
  };
}
