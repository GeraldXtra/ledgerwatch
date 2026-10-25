const COOLDOWN_MS = 60 * 60 * 1000;
const MAX_TRACKED = 500;
const MAX_TEXT = 4000;

const AREA_HOURLY_LIMITS = { browser: 5 };

const recent = new Map();
const areaSends = new Map();
let warnedNoAddress = false;

function addressOf(raw) {
  const value = String(raw || "").trim();
  const match = value.match(/<([^>]+)>/);
  return (match ? match[1] : value).trim();
}

function opsAddress() {
  for (const raw of [process.env.OPS_ALERT_EMAIL, process.env.CONTACT_EMAIL, process.env.MAIL_FROM, process.env.SMTP_USER]) {
    const address = addressOf(raw);
    if (address && address.includes("@")) return address;
  }
  return null;
}

const PHRASE_RE = /\b(?:[a-z]{3,8}\s+){11,23}[a-z]{3,8}\b/g;
const KEY_RE = /\b(?:0x)?[0-9a-fA-F]{64}\b/g;
const JWT_RE = /\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}/g;
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._-]{16,}/gi;

function scrub(text) {
  return String(text == null ? "" : text)
    .replace(JWT_RE, "[removed: token]")
    .replace(BEARER_RE, "Bearer [removed]")
    .replace(KEY_RE, "[removed: 64 hex characters, possibly a key]")
    .replace(PHRASE_RE, "[removed: a run of words that could be a recovery phrase]")
    .slice(0, MAX_TEXT);
}

function signatureOf(area, message) {
  return `${area}:${String(message || "").slice(0, 200)}`;
}

function forget(now) {
  if (recent.size <= MAX_TRACKED) return;
  for (const [sig, entry] of recent) {
    if (now - entry.sentAt > COOLDOWN_MS) recent.delete(sig);
  }
}

function areaAllows(area, now) {
  const limit = AREA_HOURLY_LIMITS[area];
  if (!limit) return true;
  const sends = (areaSends.get(area) || []).filter((t) => now - t < COOLDOWN_MS);
  if (sends.length >= limit) {
    areaSends.set(area, sends);
    return false;
  }
  sends.push(now);
  areaSends.set(area, sends);
  return true;
}

function shouldSend(area, signature, now) {
  const entry = recent.get(signature);
  if (entry && now - entry.sentAt < COOLDOWN_MS) {
    entry.suppressed += 1;
    return null;
  }
  if (!areaAllows(area, now)) return null;
  const suppressed = entry ? entry.suppressed : 0;
  recent.set(signature, { sentAt: now, suppressed: 0 });
  forget(now);
  return { suppressed };
}

async function deliver({ area, message, detail, severity, suppressed, at }) {
  const to = opsAddress();
  if (!to) {
    if (!warnedNoAddress) {
      warnedNoAddress = true;
      console.warn("[ops] problems are only logged: set OPS_ALERT_EMAIL to be emailed about them.");
    }
    return { sent: false, reason: "no-address" };
  }
  const { sendEmail } = require("./notify.service");
  const { renderActivityEmail, activityText } = require("../utils/emailBrand");
  const content = {
    subject: `LedgerWatch ${severity === "critical" ? "needs attention" : "reported a problem"}: ${area}`,
    title: severity === "critical" ? "LedgerWatch needs attention" : "LedgerWatch reported a problem",
    intro: message,
    tone: severity === "critical" ? "neg" : "info",
    rows: [
      { label: "Area", value: area },
      {
        label: "Source",
        value: area === "browser" ? "A visitor's browser. Anyone can send this report, so treat its text as unverified." : undefined,
      },
      { label: "When", value: at.toISOString() },
      { label: "Repeats in the last hour", value: suppressed ? String(suppressed) : undefined },
      { label: "Detail", value: detail || undefined, mono: true },
    ],
    reason: "You receive this email because this address is set to get LedgerWatch problem reports.",
  };
  const res = await sendEmail(to, content.subject, renderActivityEmail({ hasLogo: false, subtitle: "Problem report", ...content }), {
    text: activityText(content),
    category: "transactional",
  });
  return { sent: Boolean(res && res.ok), reason: res && res.reason };
}

function reportProblem({ area, message, detail, severity = "error" }) {
  const at = new Date();
  const cleanMessage = scrub(message || "Unknown problem").slice(0, 500);
  const cleanDetail = detail ? scrub(detail) : "";
  const gate = shouldSend(area, signatureOf(area, cleanMessage), at.getTime());
  if (!gate) return Promise.resolve({ sent: false, reason: "suppressed" });
  return deliver({ area, message: cleanMessage, detail: cleanDetail, severity, suppressed: gate.suppressed, at }).catch((err) => {
    console.error("[ops] could not send a problem report:", err.message);
    return { sent: false, reason: "send-failed" };
  });
}

function _resetForTests() {
  recent.clear();
  areaSends.clear();
  warnedNoAddress = false;
}

module.exports = { reportProblem, scrub, opsAddress, _resetForTests };
