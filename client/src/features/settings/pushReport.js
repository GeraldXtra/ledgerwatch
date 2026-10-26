const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const withDetail = (text, detail) => (detail ? `${text}: ${detail}.` : `${text}.`);

export function syncFailureText(sync) {
  if (!sync || sync.ok) return "";
  switch (sync.reason) {
    case "no-permission":
      return sync.permission === "denied"
        ? "Notifications are blocked for this site on this device, so it could not be registered."
        : "Notification permission has not been given on this device yet, so it could not be registered.";
    case "off-here":
      return "Notifications were turned off on this device, so it was not registered.";
    case "not-configured":
      return withDetail("Push is not configured on the server", sync.detail);
    case "no-key":
      return withDetail("The server's push key could not be read", sync.detail);
    case "sw-failed":
      return withDetail("The background worker that receives notifications could not start", sync.detail);
    case "subscribe-failed":
      return withDetail("The browser's push service would not give this device a subscription", sync.detail);
    case "store-failed":
      return withDetail("The server did not store this device's subscription", sync.detail);
    case "unsupported":
      return "This browser cannot receive push notifications.";
    default:
      return withDetail("This device could not be registered", sync.detail);
  }
}

export function enableFailureText(res) {
  return syncFailureText(res) || "Could not enable notifications.";
}

export function testSummary(report) {
  if (!report) return "";
  if (!report.ok) return report.error || "Nothing was sent.";
  const refused = report.refused ? `, and refused it for ${report.refused}` : "";
  return `The push service accepted the test for ${report.delivered} of ${plural(report.devices, "registered device", "registered devices")}${refused}.`;
}

export function resultLabel(result) {
  if (result.delivered) return "Accepted";
  if (result.status) return `Refused (${result.status})`;
  return "Not sent";
}

export function renewText(renewed) {
  if (!renewed) return "";
  const before = (renewed.before && renewed.before.thisDevice) || {};
  if (!renewed.ok) {
    return `This device's subscription could not be replaced. ${syncFailureText(renewed)}`;
  }
  if (before.registered === false) {
    return "This device was not registered on the server, so it was registered again and the test was sent again.";
  }
  return `The push service refused this device's old subscription (${before.status || "no answer"}), so it was replaced with a fresh one and the test was sent again.`;
}

export function blockedAdvice(device) {
  const d = device || {};
  if (d.android && d.installed) {
    return "Android has notifications switched off for the installed LedgerWatch app. Open the phone's Settings, then Apps, LedgerWatch, Notifications, and allow them. Then come back here and press Enable notifications.";
  }
  if (d.android) {
    return "Chrome has blocked notifications for this site. Tap the icon to the left of the address bar, then Permissions, and allow Notifications. Then reload this page and press Enable notifications.";
  }
  if (d.ios) {
    return "Notifications are off for LedgerWatch. Open the iPhone Settings, then Notifications, LedgerWatch, and allow them. Then come back here and press Enable notifications.";
  }
  return null;
}

function unseenAdvice(d) {
  if (d.android && d.installed) {
    return "If nothing appeared on screen, Android is hiding it: open the phone's Settings, then Apps, LedgerWatch, Notifications. Allow notifications, open each category and choose Alerting with Pop on screen. Do Not Disturb hides them too.";
  }
  if (d.android) {
    return "If nothing appeared on screen, Android is hiding Chrome's notifications: open the phone's Settings, then Apps, Chrome, Notifications, and allow them for this site with Pop on screen. Do Not Disturb hides them too.";
  }
  if (d.ios) {
    return "If nothing appeared, open the iPhone Settings, then Notifications, LedgerWatch, and allow banners. A Focus mode hides them too.";
  }
  return "If nothing appeared, the operating system is hiding it. On Windows open Settings, System, Notifications, allow them for your browser and switch off Do not disturb. On a Mac open System Settings, Notifications, and allow them for your browser.";
}

function delayedAdvice(d) {
  if (d.android) {
    return "Android may be holding it back to save battery: open the phone's Settings, then Apps, LedgerWatch (or Chrome), Battery, and choose Unrestricted, and allow background data. Then send the test again.";
  }
  return "Check that this device is online and send the test again. If it still does not arrive, press Register this device again.";
}

export function receiptAdvice(receipt, device) {
  const d = device || {};
  if (receipt === "waiting") {
    return { tone: "wait", text: "Waiting for this device to receive it.", advice: null };
  }
  if (!receipt) return null;
  if (receipt.received && receipt.shown) {
    const at = new Date(receipt.at || Date.now()).toLocaleTimeString();
    return { tone: "ok", text: `This device received the test and showed it at ${at}.`, advice: unseenAdvice(d) };
  }
  if (receipt.received) {
    return {
      tone: "error",
      text: `This device received the test but could not show it: ${receipt.error || "the browser refused"}.`,
      advice: blockedAdvice(d),
    };
  }
  const seconds = Math.round((receipt.waited || 0) / 1000);
  return {
    tone: "error",
    text: `The push service accepted the test, but this device had not received it after ${seconds} seconds.`,
    advice: delayedAdvice(d),
  };
}
