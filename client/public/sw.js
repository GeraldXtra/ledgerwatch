const API_BASE = new URL(self.location).searchParams.get("api") || self.location.origin;

self.addEventListener("install", () => {
  console.info("[sw] install");
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  console.info("[sw] activate");
  event.waitUntil(self.clients.claim());
});

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
    tag: payload.tag || type,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    actions: fitActions(payload.actions),
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

      const focused = clientList.some((c) => c.focused);

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
  const action = event.action;
  const data = notification.data || {};
  const tokens = data.tokens || {};
  notification.close();

  event.waitUntil(
    (async () => {
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

  for (const client of all) {
    if ("focus" in client) {
      try {
        await client.focus();
        if ("navigate" in client) await client.navigate(target);
        return;
      } catch {
      }
    }
  }
  if (self.clients.openWindow) await self.clients.openWindow(target);
}
