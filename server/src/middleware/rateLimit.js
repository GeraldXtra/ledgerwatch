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
  /**
   * `req.ip` ONLY. This used to read the first entry of X-Forwarded-For
   * itself, which is the entry the CLIENT writes: a proxy appends its own
   * observation to whatever header the request already carried, so
   * `X-Forwarded-For: 1.2.3.4` from a script arrived as `1.2.3.4, <real>` and
   * the bucket keyed on the made up address. Every per address limit on sign
   * in, code guessing and mail sending could be reset by changing one header.
   *
   * Express, with `trust proxy` set to the number of proxies in front of it
   * (index.js sets 1), takes the address from the END of the list, the one
   * the trusted proxy wrote, which is the only entry a client cannot choose.
   */
  return req.ip || (req.socket && req.socket.remoteAddress) || "unknown";
}

/**
 * EVERY BUCKET IS PRUNED WITH ITS OWN WINDOW, NOT THE CALLER'S. (LW-113.)
 *
 * THE DEFECT, and it was worse than an attack. This took `windowMs` from
 * whichever limiter happened to trigger the prune and applied it to EVERY bucket
 * in the shared map. Windows here range from one minute (`rpcProxy`,
 * `btc-broadcast`) to sixty (`mailSend`, `allocate`).
 *
 * Buckets were never expired anywhere else, so the map only ever grew: every
 * distinct IP that ever hit an auth route, plus every user id. A real deployment
 * reaches 50,000 keys on its own, without anybody attacking it. From that moment
 * every request prunes the whole map — and since the shortest windows are also
 * the highest-frequency callers, the effective retention for ALL buckets
 * collapses to about sixty seconds. The fifteen-minute cap on sign-in attempts,
 * and the hour-long caps on sending email and issuing payment addresses, quietly
 * became sixty-second caps. Nothing logged it.
 *
 * Reproduced during the audit: a 3-per-hour limiter, exhausted and correctly
 * blocking five minutes in, was reset to a full allowance by flooding an
 * unrelated one-minute limiter past MAX_KEYS.
 *
 * The fix is to stop guessing. Each bucket now records the window it belongs to,
 * so a prune can only ever discard hits that are genuinely expired for THAT
 * limiter. Nothing else needs to change: a bucket key already begins with the
 * limiter's name, so the window is a property of the bucket, not of the caller.
 */
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

  /**
   * If a sweep frees nothing, the map is full of LIVE entries and the ceiling is
   * genuinely too low for this deployment. Silently doing nothing would leave
   * the map growing past its bound; saying so is the only way anybody finds out.
   */
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

/**
 * The submitted email address, when the body carries one. Lowercased and
 * bounded because it becomes part of a bucket key, and a key built from
 * unbounded user input is a way to grow the map.
 */
function bodyEmail(req) {
  const raw = req && req.body && req.body.email;
  if (typeof raw !== "string") return "";
  return raw.toLowerCase().trim().slice(0, 254);
}

/**
 * @param {object} opts
 * @param {number} opts.windowMs   the sliding window
 * @param {number} opts.max        hits allowed per key per window
 * @param {string} opts.name       route label, part of the bucket key
 * @param {boolean} [opts.byUser]  key on req.user._id when present
 * @param {boolean} [opts.byEmail] add the submitted body email to the key
 * @param {string} [opts.message]  the 429 body
 */
function rateLimit({ windowMs, max, name, byUser = false, byEmail = false, message }) {
  return function limiter(req, res, next) {
    const now = Date.now();
    let who = byUser && req.user && req.user._id ? `u:${req.user._id}` : `ip:${clientIp(req)}`;
    /**
     * The ADDRESS BEING SIGNED IN TO, not only the address it came from.
     *
     * Every limit on this file's auth and mail routes was keyed on the client
     * IP alone. Most mobile internet in Nigeria, which is who this product is
     * for, puts hundreds of subscribers behind one carrier address, and so does
     * every office. Six sign-ups an hour was therefore six for the whole
     * network: the seventh person to try was told to wait an hour for something
     * a stranger did, with nothing in the message to say so. A control that
     * locks out paying customers gets switched off rather than fixed.
     *
     * Adding the submitted email narrows the bucket to one account on one
     * network, so the per-account guess budget is exactly what it was and the
     * collision between strangers is gone. The looser IP-only bucket that runs
     * alongside these (see `authAttempt` and `mailSend`) keeps a ceiling on the
     * network as a whole, so this is a narrowing plus a ceiling, not a removal.
     */
    if (byEmail) {
      const email = bodyEmail(req);
      if (email) who += `|e:${email}`;
    }
    const key = `${name}|${who}`;

    prune(now);

    // The bucket carries its OWN window, so a prune triggered by any other
    // limiter can never apply the wrong one to it. See prune().
    const bucket = buckets.get(key) || { hits: [], windowMs };
    // A limiter's window can change between deploys; the bucket follows it.
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

// ---- the limits, named so the routes read as policy ------------------------

const MIN = 60 * 1000;

/**
 * Password and code guessing: slow enough that a six digit code is not
 * guessable in its window.
 *
 * TWO buckets, and Express runs both. The first is the real limit and is keyed
 * on the address AND the email being signed in to, so one account's twenty
 * attempts are its own. The second is a much looser ceiling on the address on
 * its own, so a script working through a list of accounts from one machine is
 * still bounded — a shared carrier address behaves like a network, and a
 * scripted one behaves like a script. Routes with no email in the body (the
 * Google redirect pair) fall back to address-only in the first bucket, so they
 * keep exactly the limit they had.
 */
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

/** Anything that sends an email to an address the caller chose. Same two buckets. */
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

/** Third party spend: the AI endpoints. */
const aiCall = rateLimit({ windowMs: 5 * MIN, max: 30, name: "ai", byUser: true });

/** The browser facing RPC proxy: generous for a wallet, hostile to a script. */
const rpcProxy = rateLimit({ windowMs: MIN, max: 240, name: "rpc", byUser: true });

/** Each allocation burns a derivation index forever. */
const allocate = rateLimit({ windowMs: 60 * MIN, max: 20, name: "allocate", byUser: true });

/** Bitcoin broadcast: a relay for real money should never see a burst. */
const broadcast = rateLimit({ windowMs: MIN, max: 6, name: "btc-broadcast", byUser: true });

/**
 * Resolving a coin to its contract on a chain costs one CoinGecko call and
 * three eth_calls the first time, and nothing afterwards because the resolver
 * caches for six hours. The cap is on the first time.
 *
 * MEASURED, and the reason this number is 20 rather than the 90 it started at:
 * keyless CoinGecko refuses after exactly FIVE `/coins/{id}` calls in a row and
 * answers `Retry-After: 36`. The refusal opens the breaker in
 * coingecko.service.js, and `blockedUntil` there is one module-level value for
 * the whole process — so a single user resolving a handful of unknown coins
 * takes prices, logos, charts and coin search dark for EVERY user at once. At
 * 90 per five minutes this limit was roughly twice the entire server's upstream
 * budget, which is not a limit.
 *
 * Twenty is still generous against a six-hour cache and leaves headroom for the
 * price poll that shares the same allowance. The real fix is a shared upstream
 * budget inside coingecko.service.js, so no per-user limit can sum past it;
 * this is the bound that can be set today.
 */
const resolveToken = rateLimit({ windowMs: 5 * MIN, max: 20, name: "resolve-token", byUser: true });

/**
 * The five older doors onto the same upstream budget.
 *
 * The paragraph above was written for `/trading/resolve` and applies word for
 * word to `/api/markets`, `/api/prices`, `/api/logos`, `/api/portfolio`,
 * `/api/coins/search` and the chart route, none of which had any throttle at
 * all. They share ONE circuit breaker and ONE upstream key, so a single
 * signed-in account holding a key down in the coin search box could open the
 * breaker and take prices, logos, charts and search dark for every other user
 * at once. Limiting only the newest route closed one door in a room with six.
 *
 * MEASURED AGAINST THE CLIENT, not chosen: `useMarkets` polls every ten seconds
 * while the tab is visible (six a minute), the wallet asks for prices and logos
 * on load and on chain switch, and the coin picker is debounced at 300ms. A
 * per-route, per-user bucket at these numbers is several times anything the app
 * itself produces and still a hard ceiling on a script. Each route gets its own
 * bucket so a price poll can never lock somebody out of the search box.
 */
const priceData = (name, max) =>
  rateLimit({
    windowMs: MIN,
    max,
    name: `cg-${name}`,
    byUser: true,
    message: "You are asking for market data faster than it changes. Please wait a moment.",
  });

/**
 * The ONE unauthenticated write endpoint in the API: the button on a push
 * notification, which carries a short-lived action token instead of the session
 * JWT because a service worker cannot read one.
 *
 * Keyed on the address, because there is no session to key on. It bounds two
 * different things: a flood of invalid tokens, each of which costs a signature
 * verification, and a valid token being pressed over and over — which sends a
 * real customer a real reminder from the business's own address every time. The
 * controller also spends a token on first use; this is the bound on everything
 * that gets past that.
 */
const pushAction = rateLimit({
  windowMs: MIN,
  max: 20,
  name: "push-action",
  message: "Too many notification actions. Please open the app instead.",
});

/**
 * Saving wallet security questions costs one bcrypt hash per answer, up to six,
 * and bcrypt is deliberately slow. The answer count was capped (LW-072) but the
 * call rate was not, so a signed-in account could hold thirty-six slow hashes a
 * second on the single process that also runs the payment watch pass. Nobody
 * sets their questions more than a handful of times.
 */
const walletSecuritySet = rateLimit({
  windowMs: 15 * MIN,
  max: 10,
  name: "wallet-security-set",
  byUser: true,
  message: "Too many changes to your verification settings. Please wait a few minutes.",
});

/**
 * Adding a custom token now reads the contract before it will store it, so each
 * call costs three eth_calls against the operator's upstream quota. A wallet
 * adds a token by hand a few times in its life.
 */
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
