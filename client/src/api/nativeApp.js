function capacitor() {
  return (typeof window !== "undefined" && window.Capacitor) || null;
}

export function inNativeApp() {
  const c = capacitor();
  return Boolean(c && typeof c.isNativePlatform === "function" && c.isNativePlatform());
}

function appPlugin() {
  const c = capacitor();
  if (!inNativeApp()) return null;
  return (c.Plugins && c.Plugins.App) || null;
}

const delivered = new Set();

export function onAppUrlOpen(handler) {
  const p = appPlugin();
  if (!p || typeof p.addListener !== "function") return () => {};
  let active = true;
  const deliver = (url) => {
    const key = String(url || "");
    if (!active || !key || delivered.has(key)) return;
    delivered.add(key);
    handler(key);
  };
  const handle = Promise.resolve(p.addListener("appUrlOpen", (event) => deliver(event && event.url))).catch(
    () => null
  );
  if (typeof p.getLaunchUrl === "function") {
    Promise.resolve(p.getLaunchUrl())
      .then((r) => deliver(r && r.url))
      .catch(() => {});
  }
  return () => {
    active = false;
    handle.then((h) => h && h.remove && h.remove()).catch(() => {});
  };
}
