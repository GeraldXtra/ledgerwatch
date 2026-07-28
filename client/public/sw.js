/* LedgerWatch service worker — Web Push + notification action handling.
 *
 * The API base is passed on the registration URL (/sw.js?api=<base>) so it survives
 * SW restarts (self.location is stable), falling back to same-origin. A service
 * worker cannot read the JWT from localStorage, so each actionable notification
 * carries short-lived, single-purpose action tokens in its payload; the buttons
 * POST those tokens to /api/push/action, which validates the bound action + resource.
 */

const API_BASE =
  new URL(self.location).searchParams.get("api") || self.location.origin;

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (e) {
    payload = { title: "LedgerWatch", body: event.data ? event.data.text() : "" };
  }

  const title = payload.title || "LedgerWatch";
  const options = {
    body: payload.body || "",
    tag: payload.tag,
    icon: "/icon.svg",
    badge: "/icon.svg",
    // Keep the actions the server sent; the buttons map to tokens in `data`.
    actions: Array.isArray(payload.actions) ? payload.actions : [],
    data: {
      url: payload.url || "/app",
      tokens: payload.tokens || {},
      type: payload.type || "info",
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  const notification = event.notification;
  const action = event.action; // "" when the body (not a button) was clicked
  const data = notification.data || {};
  const tokens = data.tokens || {};
  notification.close();

  event.waitUntil(
    (async () => {
      // A button bound to a server action → call the authenticated action endpoint.
      if (action && tokens[action]) {
        try {
          await fetch(`${API_BASE}/api/push/action`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: tokens[action], action }),
          });
        } catch (e) {
          // Swallow — the user can still act in-app.
        }
        // For send/approve, we don't need to open a window; for approve, showing the
        // app lets them see the portfolio move.
        if (action === "approve") {
          await openApp(data.url);
        }
        return;
      }

      // Plain dismiss button (no token) or dismiss of a reminder → just close.
      if (action === "dismiss") return;

      // Body click (or an action with no token) → focus/open the app.
      await openApp(data.url);
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
      } catch (e) {
        /* fall through to openWindow */
      }
    }
  }
  if (self.clients.openWindow) await self.clients.openWindow(target);
}
