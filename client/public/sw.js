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

const ICON_HOSTS = ["coin-images.coingecko.com", "assets.coingecko.com"];

function iconFor(raw) {
  try {
    const u = new URL(String(raw));
    return u.protocol === "https:" && ICON_HOSTS.includes(u.hostname) ? u.href : "/icon-192.png";
  } catch {
    return "/icon-192.png";
  }
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
    renotify: true,
    icon: iconFor(payload.icon),
    badge: "/icon-192.png",
    timestamp: Date.now(),
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
      clientList.forEach((c) => c.postMessage({ type: "push", payload, shown: true }));

      console.info("[sw] showing OS notification:", payload.title);
      try {
        await self.registration.showNotification(payload.title || "LedgerWatch", options);
      } catch (err) {
        console.warn("[sw] notification with icon failed, retrying plain:", err && err.message);
        await self.registration.showNotification(payload.title || "LedgerWatch", {
          ...options,
          icon: "/icon-192.png",
          actions: [],
        });
      }
    })()
  );
});

function keyBytes(base64) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const old = event.oldSubscription || null;
      let next = event.newSubscription || null;
      try {
        if (!next) {
          let key = old && old.options ? old.options.applicationServerKey : null;
          if (!key) {
            const res = await fetch(`${API_BASE}/api/push/vapid`);
            const body = await res.json().catch(() => ({}));
            key = body.publicKey ? keyBytes(body.publicKey) : null;
          }
          if (!key) return;
          next = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
        }
        if (!old || !old.endpoint) {
          await postToClients({ type: "push-resubscribed", endpoint: next.endpoint });
          return;
        }
        const res = await fetch(`${API_BASE}/api/push/resubscribe`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ oldEndpoint: old.endpoint, subscription: next.toJSON() }),
        });
        console.info("[sw] subscription renewed:", res.status);
      } catch (err) {
        console.warn("[sw] could not renew the subscription:", err && err.message);
      }
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

function samePath(url) {
  const raw = typeof url === "string" ? url : "";
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return "/app";
  try {
    const u = new URL(raw, self.location.origin);
    return u.origin === self.location.origin ? u.pathname + u.search : "/app";
  } catch {
    return "/app";
  }
}

async function openApp(url) {
  const target = samePath(url);
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
