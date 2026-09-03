import http from "../../api/http";
import { coinIdForSymbol } from "./usdValue";

/**
 * Logo URLs for wallet tokens, keyed by the SYMBOL the wallet already uses.
 *
 * WHY THIS EXISTS RATHER THAN A FETCH IN THE COMPONENT
 *
 * A wallet row does not know about its seven neighbours. If each TokenLogo asked
 * for its own URL, an eight token chain would fire eight requests for eight rows
 * of ONE cached markets response, and a chain switch would fire eight more. This
 * collects every symbol asked for in the same tick into a single call, and
 * remembers the answer for the session, so the whole list costs one request.
 *
 * It reuses coinIdForSymbol from usdValue.js on purpose. That map is the reason
 * WETH prices as ether rather than as nothing, and a second copy here would
 * eventually disagree with it — the wallet would then price a token it could not
 * draw, or draw one it could not price.
 */

const KEY = (symbol) => String(symbol || "").trim().toUpperCase();

/**
 * SYMBOL -> url, or null for "we asked and CoinGecko has no artwork for this".
 * A null is a real answer and is safe to keep: it stops us asking again for a
 * token that will never have a logo.
 */
const cache = new Map();

/**
 * THE CACHE OUTLIVES THE PAGE, the way a wallet's artwork does.
 *
 * Resolved URLs are written to localStorage and read back on the next visit,
 * so a logo that has been seen once is drawn on the first frame of every later
 * load, on every network, and with no connection at all. That is how MetaMask
 * behaves and it is what the owner asked for: the mark for USDC is the mark
 * for USDC, whichever chain is selected and whether or not the price feed is
 * answering today.
 *
 * Only real URLs are persisted. A `null` (no artwork) is a per session answer
 * that may have been a transient miss, and writing it to disk would turn one
 * bad minute into a lettered wallet forever, which is the latching failure this
 * project keeps having to unlearn.
 */
const STORE_KEY = "ledgerwatch.logos.v1";

function persistLogos() {
  try {
    const out = {};
    for (const [key, url] of cache) if (typeof url === "string" && url) out[key] = url;
    localStorage.setItem(STORE_KEY, JSON.stringify(out));
  } catch {
    /* private mode or a full store: the session cache still works */
  }
}

function loadPersistedLogos() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object") return;
    for (const [key, url] of Object.entries(obj)) {
      if (typeof url === "string" && url) cache.set(KEY(key), url);
    }
  } catch {
    /* a corrupt entry is ignored and rewritten on the next success */
  }
}

loadPersistedLogos();

/**
 * SYMBOL -> timestamp after which a FAILED lookup may be retried.
 *
 * Kept separate from `cache` deliberately. This project has been bitten before
 * by a cache that latched a failure — one bad read meant every email for the
 * life of the process went out with no logo — so a transport failure must never
 * be recorded as "this token has no logo". It gets a cooldown instead: we stop
 * hammering a dead endpoint, and a wallet reopened later still tries again.
 */
const failedUntil = new Map();
const RETRY_AFTER_MS = 60 * 1000;

/**
 * Symbols whose URL loaded and then failed in the browser (a 404, a blocked
 * host). Per symbol rather than per component, so scrolling a row out and back
 * does not re-request an image we already know is not there.
 */
const broken = new Set();

const subscribers = new Set();

function notify() {
  for (const fn of subscribers) {
    try {
      fn();
    } catch {
      // One bad subscriber must not stop the rest of the list from updating.
    }
  }
}

/**
 * Subscribe to logo cache changes. Returns an unsubscribe function.
 */
export function subscribe(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

/**
 * The URL for a symbol, if we have one.
 *
 * `undefined` means we have not asked yet, `null` means there is nothing to
 * draw. Both render the lettered disc, so a caller only has to test for a
 * truthy string — there is no state in which this returns something that must
 * not be put in an <img>.
 */
export function getLogoUrl(symbol) {
  const key = KEY(symbol);
  if (broken.has(key)) return null;
  return cache.get(key);
}

/**
 * Record that a URL failed to load in the browser, permanently for this session.
 */
export function markLogoBroken(symbol) {
  const key = KEY(symbol);
  if (!key || broken.has(key)) return;
  broken.add(key);
  // Drop the dead URL from the persisted set too, so the next visit asks for a
  // fresh one rather than reloading a file that is known to 404.
  cache.delete(key);
  persistLogos();
  notify();
}

// ---- batching -------------------------------------------------------------

let queued = new Set();
let flushTimer = null;

function schedule() {
  if (flushTimer !== null) return;
  // A zero delay macrotask, not a microtask. React runs every row's effect in
  // one batch after the commit, so this fires once with the whole wallet in it.
  flushTimer = setTimeout(flush, 0);
}

async function flush() {
  flushTimer = null;
  const batch = [...queued];
  queued = new Set();
  if (batch.length === 0) return;

  const idFor = new Map();
  for (const key of batch) {
    const id = coinIdForSymbol(key);
    if (id) idFor.set(key, id);
  }
  const ids = [...new Set(idFor.values())];
  if (ids.length === 0) return;

  try {
    const { data } = await http.get("/api/logos", { params: { ids: ids.join(",") } });
    const byId = data?.logos || {};

    /**
     * AN EMPTY ANSWER IS NOT AN ANSWER, AND THIS IS THE BUG THAT HID THE LOGOS.
     *
     * This used to write `cache.set(key, null)` for every symbol the response
     * did not cover. `null` in this cache means "asked, and this token has no
     * artwork" — a PERMANENT answer that stops us ever asking again. But the
     * server returns an empty map whenever its own price cache is still cold or
     * the upstream refused it, which is a TRANSIENT condition. One unlucky first
     * request therefore marked every token in the wallet as having no logo for
     * the rest of the session, and only a page reload cleared it.
     *
     * It bit mainnet hardest and testnet barely at all, which made it look like
     * a mainnet-specific fault: a testnet wallet asks about two coins, a mainnet
     * wallet about fifteen, so mainnet was far likelier to catch the cold cache.
     *
     * The response carries `stale`, and a live response proves itself by
     * containing at least one logo. Only then is an absent id a real "no
     * artwork". Otherwise it is a miss, and a miss gets a cooldown and a retry.
     * This is the same rule the logo attachment in the mailer had to learn: a
     * cache must never latch a failure.
     */
    const answered = Object.keys(byId).length > 0;
    const trustworthy = answered && !data?.stale;

    let missed = false;
    for (const key of batch) {
      const id = idFor.get(key);
      const url = id ? byId[id] : null;

      if (typeof url === "string" && url) {
        cache.set(key, url);
        failedUntil.delete(key);
      } else if (trustworthy) {
        cache.set(key, null); // genuinely has no artwork; stop asking
        failedUntil.delete(key);
      } else {
        missed = true; // transient: leave the cache alone and try again
        failedUntil.set(key, Date.now() + RETRY_AFTER_MS);
      }
    }
    persistLogos();
    if (missed) scheduleRetry(batch);
  } catch {
    /**
     * The wallet is fully usable without this. Every balance, every value and
     * every action already rendered; only the disc art is missing, and the
     * lettered disc is what was there before this feature existed. So the
     * failure is recorded as a retry cooldown and nothing else — no toast, no
     * error state, and above all nothing written into `cache`, which would turn
     * one bad minute into a lettered wallet for the rest of the session.
     */
    const until = Date.now() + RETRY_AFTER_MS;
    for (const key of batch) failedUntil.set(key, until);
    scheduleRetry(batch);
  }

  notify();
}

/**
 * Come back and ask again, rather than waiting for the component to remount.
 *
 * Without this, a first attempt that missed left the wallet lettered until the
 * user reloaded the page — which is exactly what they had to keep doing. The
 * effect in TokenLogo only re-runs when its symbol changes, so nothing else was
 * ever going to ask a second time.
 *
 * Bounded on purpose: a handful of widening attempts, then it stops. A wallet
 * left open overnight must not sit in a retry loop against an endpoint that has
 * already said no, and the lettered disc is a perfectly good permanent outcome.
 */
const MAX_RETRIES = 4;
const retriesFor = new Map(); // SYMBOL -> attempts already made

function scheduleRetry(batch) {
  const due = batch.filter((key) => (retriesFor.get(key) || 0) < MAX_RETRIES);
  if (due.length === 0) return;

  // Widening backoff from the cooldown, so a provider that is rate limiting us
  // gets progressively more room rather than the same pressure every minute.
  const attempt = Math.min(...due.map((key) => retriesFor.get(key) || 0));
  const delay = RETRY_AFTER_MS * Math.pow(2, attempt);

  for (const key of due) retriesFor.set(key, (retriesFor.get(key) || 0) + 1);

  setTimeout(() => {
    for (const key of due) {
      failedUntil.delete(key);
      requestLogo(key);
    }
  }, delay);
}

/**
 * Ask for one symbol's logo. Cheap and idempotent: safe to call on every render
 * of every row. Nothing happens if the answer is already known, if the symbol
 * has no CoinGecko mapping, or if a recent lookup failed and is still cooling
 * down.
 */
export function requestLogo(symbol) {
  const key = KEY(symbol);
  if (!key || cache.has(key) || queued.has(key)) return;

  if (!coinIdForSymbol(key)) {
    // No mapping, so there is nothing to look up and never will be. Recorded so
    // a custom token added by the user does not re-queue on every render.
    cache.set(key, null);
    return;
  }

  const until = failedUntil.get(key);
  if (until && Date.now() < until) return;

  queued.add(key);
  schedule();
}

/**
 * Ask for a whole list at once. Same result as calling requestLogo for each,
 * offered for a caller that already holds the full set of symbols and would
 * rather not rely on the per row batching window.
 */
export function prefetchLogos(symbols) {
  for (const symbol of symbols || []) requestLogo(symbol);
}
