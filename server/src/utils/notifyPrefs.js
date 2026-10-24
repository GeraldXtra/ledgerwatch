const NOTIFY_PREF_KEYS = [
  "marketAlerts",
  "remindersDue",
  "txUpdates",
  "moneyIn",
  "trades",
  "profit",
  "emailActivity",
];

function notifyPrefsOf(stored) {
  const prefs = stored && typeof stored.toObject === "function" ? stored.toObject() : stored || {};
  const out = {};
  for (const key of NOTIFY_PREF_KEYS) out[key] = prefs[key] !== false;
  return out;
}

module.exports = { NOTIFY_PREF_KEYS, notifyPrefsOf };
