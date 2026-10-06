import http from "../../api/http";
import { coinIdForSymbol } from "./usdValue";

const KEY = (symbol) => String(symbol || "").trim().toUpperCase();

const cache = new Map();

const STORE_KEY = "ledgerwatch.logos.v1";

function persistLogos() {
  try {
    const out = {};
    for (const [key, url] of cache) if (typeof url === "string" && url) out[key] = url;
    localStorage.setItem(STORE_KEY, JSON.stringify(out));
  } catch {
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
  }
}

loadPersistedLogos();

const failedUntil = new Map();
const RETRY_AFTER_MS = 60 * 1000;

const broken = new Set();

const subscribers = new Set();

function notify() {
  for (const fn of subscribers) {
    try {
      fn();
    } catch {
    }
  }
}

export function subscribe(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

export function getLogoUrl(symbol) {
  const key = KEY(symbol);
  if (broken.has(key)) return null;
  return cache.get(key);
}

export function markLogoBroken(symbol) {
  const key = KEY(symbol);
  if (!key || broken.has(key)) return;
  broken.add(key);
  cache.delete(key);
  persistLogos();
  notify();
}

let queued = new Set();
let flushTimer = null;

function schedule() {
  if (flushTimer !== null) return;
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
        cache.set(key, null);
        failedUntil.delete(key);
      } else {
        missed = true;
        failedUntil.set(key, Date.now() + RETRY_AFTER_MS);
      }
    }
    persistLogos();
    if (missed) scheduleRetry(batch);
  } catch {
    const until = Date.now() + RETRY_AFTER_MS;
    for (const key of batch) failedUntil.set(key, until);
    scheduleRetry(batch);
  }

  notify();
}

const MAX_RETRIES = 4;
const retriesFor = new Map();

function scheduleRetry(batch) {
  const due = batch.filter((key) => (retriesFor.get(key) || 0) < MAX_RETRIES);
  if (due.length === 0) return;

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

export function requestLogo(symbol) {
  const key = KEY(symbol);
  if (!key || cache.has(key) || queued.has(key)) return;

  if (!coinIdForSymbol(key)) {
    cache.set(key, null);
    return;
  }

  const until = failedUntil.get(key);
  if (until && Date.now() < until) return;

  queued.add(key);
  schedule();
}

export function prefetchLogos(symbols) {
  for (const symbol of symbols || []) requestLogo(symbol);
}
