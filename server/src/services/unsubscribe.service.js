const crypto = require("crypto");
const { scopedRepo } = require("../repositories/scoped");
const { clientUrl, serverUrl } = require("../utils/links");

const KINDS = new Set(["debtor", "owner"]);
const OBJECT_ID_RE = /^[0-9a-fA-F]{24}$/;

function signingKey() {
  return crypto
    .createHmac("sha256", String(process.env.JWT_SECRET || ""))
    .update("ledgerwatch-unsubscribe-v1")
    .digest();
}

function mac(body) {
  return crypto.createHmac("sha256", signingKey()).update(body).digest().subarray(0, 16).toString("base64url");
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function unsubscribeToken({ kind, userId, email }) {
  if (!KINDS.has(kind)) throw new Error("Unknown unsubscribe kind");
  const payload = { k: kind, u: String(userId) };
  if (kind === "debtor") payload.e = normalizeEmail(email);
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${mac(body)}`;
}

function readToken(token) {
  const [body, given, extra] = String(token || "").split(".");
  if (!body || !given || extra !== undefined || body.length > 600) return null;
  const expected = Buffer.from(mac(body));
  const supplied = Buffer.from(given);
  if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!payload || !KINDS.has(payload.k) || !OBJECT_ID_RE.test(String(payload.u))) return null;
  if (payload.k === "debtor" && !payload.e) return null;
  return { kind: payload.k, userId: payload.u, email: payload.k === "debtor" ? normalizeEmail(payload.e) : null };
}

function unsubscribeLinks(params) {
  const token = unsubscribeToken(params);
  return {
    token,
    page: clientUrl(`/unsubscribe/${token}`),
    oneClick: serverUrl(`/api/public/unsubscribe/${token}`),
  };
}

async function isOptedOut(ownerId, email) {
  const address = normalizeEmail(email);
  if (!address) return false;
  return Boolean(await scopedRepo(ownerId).emailOptOuts.exists({ email: address }));
}

async function optOutStatus(claims) {
  if (claims.kind === "owner") {
    const owner = await scopedRepo(claims.userId).self.get("notifyPrefs").lean();
    if (!owner) return null;
    return { unsubscribed: Boolean(owner.notifyPrefs && owner.notifyPrefs.emailActivity === false) };
  }
  return { unsubscribed: await isOptedOut(claims.userId, claims.email) };
}

async function optOut(claims, source) {
  const repo = scopedRepo(claims.userId);
  if (claims.kind === "owner") {
    await repo.self.updateOne({ $set: { "notifyPrefs.emailActivity": false } });
    return { unsubscribed: true };
  }
  await repo.emailOptOuts.updateOne(
    { email: claims.email },
    { $setOnInsert: { email: claims.email, kind: "reminders", source, createdAt: new Date() } },
    { upsert: true }
  );
  return { unsubscribed: true };
}

async function optBackIn(claims) {
  const repo = scopedRepo(claims.userId);
  if (claims.kind === "owner") {
    await repo.self.updateOne({ $set: { "notifyPrefs.emailActivity": true } });
  } else {
    await repo.emailOptOuts.deleteOne({ email: claims.email });
  }
  return { unsubscribed: false };
}

module.exports = {
  unsubscribeToken,
  readToken,
  unsubscribeLinks,
  isOptedOut,
  optOutStatus,
  optOut,
  optBackIn,
  normalizeEmail,
};
