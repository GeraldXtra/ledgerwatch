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
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", t === "dark" ? "#0C0D0F" : "#16191F");
}

export function setTheme(theme) {
  try {
    localStorage.setItem(KEY, theme === "dark" ? "dark" : "light");
  } catch {
  }
  applyTheme(theme);
  window.dispatchEvent(new Event(EVENT));
}

export function toggleTheme() {
  setTheme(currentTheme() === "dark" ? "light" : "dark");
}

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
    media = null;
  }

  return () => {
    window.removeEventListener(EVENT, fn);
    if (media) {
      try {
        media.removeEventListener("change", onSystem);
      } catch {
      }
    }
  };
}
