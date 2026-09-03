/**
 * A rate limiter with no dependency and no store.
 *
 * WHY IT EXISTS. There was no throttle anywhere in the API. Login ran bcrypt
 * for every attempt, so a few hundred concurrent requests pinned the CPU;
 * verify-email and the reset endpoints could be guessed at without limit; the
 * resend endpoints could mail any address at our domain's reputation; the AI
 * routes were uncapped third party spend; and the RPC proxy let one account
 * exhaust the operator's upstream quota.
 *
 * WHY IN MEMORY. This server runs as a single process and has no Redis. A
 * process local sliding window is exactly right for that shape: it costs
 * nothing, it is correct for one instance, and it resets on restart, which for
 * an abuse limiter is acceptable. If this ever runs as several instances the
 * limit is per instance, which is weaker but still a limit; move the store
 * then, not before.
 *
 * WHY PER IP AND PER ROUTE. A limit shared across routes would let a burst of
 * price polls lock somebody out of signing in. Each route gets its own bucket.
 * For the unauthenticated routes the key is the client IP. For authenticated
 * routes it is the user id when present, so a shared office IP does not
 * penalise everyone at once.
 *
 * Bounded memory: buckets are pruned on every hit once the map grows past a
 * ceiling, so an attacker rotating addresses cannot grow the heap without
 * bound.
 */

const buckets = new Map(); // key -> number[] of hit timestamps
const MAX_KEYS = 50000;

function clientIp(req) {
  // Render, Vercel and most proxies set this; Express only honours it with
  // trust proxy on, which index.js sets. Falls back to the socket address.
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf.length) return xf.split(",")[0].trim();
  return req.ip || (req.socket && req.socket.remoteAddress) || "unknown";
}

function prune(now, windowMs) {
  if (buckets.size < MAX_KEYS) return;
  for (const [k, hits] of buckets) {
    const live = hits.filter((t) => now - t < windowMs);
    if (live.length === 0) buckets.delete(k);
    else buckets.set(k, live);
  }
}

/**
 * @param {object} opts
 * @param {number} opts.windowMs   the sliding window
 * @param {number} opts.max        hits allowed per key per window
 * @param {string} opts.name       route label, part of the bucket key
 * @param {boolean} [opts.byUser]  key on req.user._id when present
 * @param {string} [opts.message]  the 429 body
 */
function rateLimit({ windowMs, max, name, byUser = false, message }) {
  return function limiter(req, res, next) {
    const now = Date.now();
    const who = byUser && req.user && req.user._id ? `u:${req.user._id}` : `ip:${clientIp(req)}`;
    const key = `${name}|${who}`;

    prune(now, windowMs);

    const hits = (buckets.get(key) || []).filter((t) => now - t < windowMs);
    if (hits.length >= max) {
      const retryAfter = Math.ceil((windowMs - (now - hits[0])) / 1000);
      res.setHeader("Retry-After", String(Math.max(1, retryAfter)));
      return res.status(429).json({
        error: message || "Too many requests. Please wait a moment and try again.",
        retryAfter: Math.max(1, retryAfter),
      });
    }
    hits.push(now);
    buckets.set(key, hits);
    return next();
  };
}

// ---- the limits, named so the routes read as policy ------------------------

const MIN = 60 * 1000;

/** Password and code guessing: slow enough that a six digit code is not guessable in its window. */
const authAttempt = (name) =>
  rateLimit({ windowMs: 15 * MIN, max: 20, name, message: "Too many attempts. Please wait fifteen minutes." });

/** Anything that sends an email to an address the caller chose. */
const mailSend = (name) =>
  rateLimit({ windowMs: 60 * MIN, max: 6, name, message: "Too many emails requested. Please wait an hour." });

/** Third party spend: the AI endpoints. */
const aiCall = rateLimit({ windowMs: 5 * MIN, max: 30, name: "ai", byUser: true });

/** The browser facing RPC proxy: generous for a wallet, hostile to a script. */
const rpcProxy = rateLimit({ windowMs: MIN, max: 240, name: "rpc", byUser: true });

/** Each allocation burns a derivation index forever. */
const allocate = rateLimit({ windowMs: 60 * MIN, max: 20, name: "allocate", byUser: true });

/** Bitcoin broadcast: a relay for real money should never see a burst. */
const broadcast = rateLimit({ windowMs: MIN, max: 6, name: "btc-broadcast", byUser: true });

module.exports = { rateLimit, authAttempt, mailSend, aiCall, rpcProxy, allocate, broadcast };
