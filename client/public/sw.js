/* LedgerWatch service worker — Web Push delivery and notification actions.
 *
 * The API base is passed on the registration URL (/sw.js?api=<base>) because a
 * service worker cannot read localStorage and self.location survives restarts.
 *
 * SECURITY: a service worker has no access to the Bearer JWT, so actionable
 * notifications carry short-lived, single-purpose tokens instead. Only actions
 * that are safe to perform unattended (dismiss, send a reminder) carry one.
 * Buy and Sell deliberately carry NO token — they open the app so the user still
 * sets an amount and confirms. A trade must never fire from a notification.
 */

const API_BASE = new URL(self.location).searchParams.get("api") || self.location.origin;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "LedgerWatch", body: event.data ? event.data.text() : "" };
  }

  const options = {
    body: payload.body || "",
    tag: payload.tag,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    actions: Array.isArray(payload.actions) ? payload.actions.slice(0, 3) : [],
    data: {
      url: payload.url || "/app",
      tokens: payload.tokens || {},
      type: payload.type || "info",
      alertId: payload.alertId || null,
    },
  };

  event.waitUntil(
    (async () => {
      // If a window is already focused the page shows its own in-app toast, so
      // suppress the OS notification rather than telling the user twice.
      const clientList = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const focused = clientList.some((c) => c.focused || c.visibilityState === "visible");
      if (focused) {
        clientList.forEach((c) => c.postMessage({ type: "push", payload }));
        return;
      }
      await self.registration.showNotification(payload.title || "LedgerWatch", options);
    })()
  );
});

self.addEventListener("notificationclick", (event) => {
  const notification = event.notification;
  const action = event.action; // "" when the body, not a button, was clicked
  const data = notification.data || {};
  const tokens = data.tokens || {};
  notification.close();

  event.waitUntil(
    (async () => {
      // Actions that carry a token are safe to resolve without opening the app.
      if (action && tokens[action]) {
        try {
          await fetch(`${API_BASE}/api/push/action`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: tokens[action], action }),
          });
        } catch {
          // Swallow — the user can still act in the app.
        }
        return;
      }

      // Buy/Sell carry no token by design: open the app on that alert's trade
      // panel so the amount and confirmation step still happen.
      let url = data.url || "/app";
      if ((action === "buy" || action === "sell") && data.alertId) {
        url = `/app/market?alert=${data.alertId}&side=${action}`;
      }
      await openApp(url);
    })()
  );
});

async function openApp(url) {
  const target = url || "/app";
  const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of all) {
    if ("focus" in client) {
      try {
        await client.focus();
        if ("navigate" in client) await client.navigate(target);
        return;
      } catch {
        /* fall through to openWindow */
      }
    }
  }
  if (self.clients.openWindow) await self.clients.openWindow(target);
}
