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

self.addEventListener("install", () => {
  console.info("[sw] install");
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  console.info("[sw] activate");
  event.waitUntil(self.clients.claim());
});

/**
 * How many action buttons this platform will actually render.
 *
 * Chrome on desktop allows TWO. Sending three does not error — the extra one is
 * silently dropped — so the payload orders actions by value and this trims from
 * the end, meaning the least important is the one that goes.
 */
function fitActions(actions) {
  if (!Array.isArray(actions) || actions.length === 0) return [];
  const max =
    self.Notification && typeof self.Notification.maxActions === "number"
      ? self.Notification.maxActions
      : 2;
  if (actions.length > max) {
    console.info(`[sw] trimming ${actions.length} actions to maxActions=${max}`);
  }
  return actions.slice(0, Math.max(0, max));
}

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "LedgerWatch", body: event.data ? event.data.text() : "" };
  }

  const type = payload.type || "info";

  const options = {
    body: payload.body || "",
    // A tag per notification type means a repeated alert REPLACES the previous
    // one rather than stacking a tower of them in the Action Center.
    tag: payload.tag || type,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    actions: fitActions(payload.actions),
    // Market alerts are time sensitive and worth persisting: without this Windows
    // auto-dismisses after a few seconds and the user never sees it.
    requireInteraction: type === "alert",
    data: {
      url: payload.url || "/app",
      tokens: payload.tokens || {},
      type,
      alertId: payload.alertId || null,
    },
  };

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      // FOCUSED, not merely visible. A visible-but-unfocused window is one the
      // user is not looking at, so it still deserves an OS notification —
      // suppressing on visibility meant a second monitor swallowed everything.
      const focused = clientList.some((c) => c.focused);

      // A test notification ALWAYS shows the OS notification. Its entire job is
      // to prove OS delivery works; suppressing it would make it prove nothing.
      if (focused && type !== "test") {
        console.info("[sw] window focused — in-app toast instead of OS notification");
        clientList.forEach((c) => c.postMessage({ type: "push", payload }));
        return;
      }

      console.info("[sw] showing OS notification:", payload.title);
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
        let ok = false;
        let message = "";
        try {
          const res = await fetch(`${API_BASE}/api/push/action`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: tokens[action], action }),
          });
          ok = res.ok;
          if (!ok) {
            const body = await res.json().catch(() => ({}));
            message = body.error || `Request failed (${res.status})`;
          }
        } catch (err) {
          message = err.message || "Network error";
        }

        // Report back so the app can toast the outcome when next looked at.
        // Silence here is how a failed "Send email" from a notification would
        // otherwise look identical to a successful one.
        await postToClients({
          type: "action-result",
          action,
          ok,
          message,
          notificationType: data.type,
        });
        if (!ok) console.warn("[sw] action failed:", action, message);
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

async function postToClients(message) {
  const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  all.forEach((c) => c.postMessage(message));
  return all.length;
}

async function openApp(url) {
  const target = url || "/app";
  const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });

  // Prefer an existing window: focus it and navigate, so the user does not end up
  // with a second copy of the app every time they tap a notification.
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
