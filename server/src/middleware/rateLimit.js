const buckets = new Map();
const MAX_KEYS = 50000;

function clientIp(req) {
  return req.ip || (req.socket && req.socket.remoteAddress) || "unknown";
}

function prune(now) {
  if (buckets.size < MAX_KEYS) return;

  let dropped = 0;
  for (const [k, bucket] of buckets) {
    const live = bucket.hits.filter((t) => now - t < bucket.windowMs);
    if (live.length === 0) {
      buckets.delete(k);
      dropped++;
    } else {
      bucket.hits = live;
    }
  }

  if (dropped === 0) {
    const now2 = Date.now();
    if (now2 - lastFullWarnAt > 60 * 60 * 1000) {
      lastFullWarnAt = now2;
      console.warn(
        `[rateLimit] ${buckets.size} live buckets and a sweep freed none. MAX_KEYS (${MAX_KEYS}) ` +
          "is too low for this traffic, or a limiter's window is too long. Nothing was discarded, " +
          "so limits are still correct — but memory will keep growing until this is raised."
      );
    }
  }
}

let lastFullWarnAt = 0;

function bodyEmail(req) {
  const raw = req && req.body && req.body.email;
  if (typeof raw !== "string") return "";
  return raw.toLowerCase().trim().slice(0, 254);
}

function rateLimit({ windowMs, max, name, byUser = false, byEmail = false, message }) {
  return function limiter(req, res, next) {
    const now = Date.now();
    let who = byUser && req.user && req.user._id ? `u:${req.user._id}` : `ip:${clientIp(req)}`;
    if (byEmail) {
      const email = bodyEmail(req);
      if (email) who += `|e:${email}`;
    }
    const key = `${name}|${who}`;

    prune(now);

    const bucket = buckets.get(key) || { hits: [], windowMs };
    bucket.windowMs = windowMs;
    const hits = bucket.hits.filter((t) => now - t < windowMs);
    if (hits.length >= max) {
      const retryAfter = Math.ceil((windowMs - (now - hits[0])) / 1000);
      res.setHeader("Retry-After", String(Math.max(1, retryAfter)));
      return res.status(429).json({
        error: message || "Too many requests. Please wait a moment and try again.",
        retryAfter: Math.max(1, retryAfter),
      });
    }
    hits.push(now);
    bucket.hits = hits;
    buckets.set(key, bucket);
    return next();
  };
}

const MIN = 60 * 1000;

const authAttempt = (name) => [
  rateLimit({
    windowMs: 15 * MIN,
    max: 20,
    name,
    byEmail: true,
    message: "Too many attempts. Please wait fifteen minutes.",
  }),
  rateLimit({
    windowMs: 15 * MIN,
    max: 200,
    name: `${name}:ip`,
    message: "This network has made a lot of attempts. Please wait fifteen minutes.",
  }),
];

const mailSend = (name) => [
  rateLimit({
    windowMs: 60 * MIN,
    max: 6,
    name,
    byEmail: true,
    message: "Too many emails requested. Please wait an hour.",
  }),
  rateLimit({
    windowMs: 60 * MIN,
    max: 40,
    name: `${name}:ip`,
    message: "This network has requested a lot of emails. Please wait an hour.",
  }),
];

const aiCall = rateLimit({ windowMs: 5 * MIN, max: 30, name: "ai", byUser: true });

const rpcProxy = rateLimit({ windowMs: MIN, max: 240, name: "rpc", byUser: true });

const allocate = rateLimit({ windowMs: 60 * MIN, max: 20, name: "allocate", byUser: true });

const broadcast = rateLimit({ windowMs: MIN, max: 6, name: "btc-broadcast", byUser: true });

const resolveToken = rateLimit({ windowMs: 5 * MIN, max: 20, name: "resolve-token", byUser: true });

const priceData = (name, max) =>
  rateLimit({
    windowMs: MIN,
    max,
    name: `cg-${name}`,
    byUser: true,
    message: "You are asking for market data faster than it changes. Please wait a moment.",
  });

const pushAction = rateLimit({
  windowMs: MIN,
  max: 20,
  name: "push-action",
  message: "Too many notification actions. Please open the app instead.",
});

const walletSecuritySet = rateLimit({
  windowMs: 15 * MIN,
  max: 10,
  name: "wallet-security-set",
  byUser: true,
  message: "Too many changes to your verification settings. Please wait a few minutes.",
});

const addToken = rateLimit({
  windowMs: 5 * MIN,
  max: 20,
  name: "add-token",
  byUser: true,
  message: "Too many tokens added at once. Please wait a few minutes.",
});

module.exports = {
  rateLimit,
  authAttempt,
  mailSend,
  aiCall,
  rpcProxy,
  allocate,
  broadcast,
  resolveToken,
  priceData,
  pushAction,
  walletSecuritySet,
  addToken,
};
