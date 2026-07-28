import { useCallback, useEffect, useRef, useState } from "react";
import http from "../../api/http";

const POLL_MS = 10000;

/**
 * Polls /api/markets every 10s WHILE the tab is visible, pausing when the page is
 * hidden (Page Visibility API) and resuming with an immediate fetch on focus. The
 * server cache absorbs the frequency, so many polls cost few upstream calls.
 *
 * Returns a { coinId -> market } map plus `stale`, `updatedAt` (server timestamp),
 * and `lastFetchedAt` (client clock, for the "updated Xs ago" indicator).
 *
 * @param {string[]} coinIds
 */
export default function useMarkets(coinIds) {
  const [markets, setMarkets] = useState({});
  const [stale, setStale] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [lastFetchedAt, setLastFetchedAt] = useState(null);

  // Keep the latest ids in a ref so the interval callback is stable.
  const idsRef = useRef([]);
  idsRef.current = [...new Set((coinIds || []).filter(Boolean))].sort();
  const idsKey = idsRef.current.join(",");

  const fetchNow = useCallback(async () => {
    const ids = idsRef.current;
    if (ids.length === 0) {
      setMarkets({});
      return;
    }
    try {
      const { data } = await http.get("/api/markets", {
        params: { ids: ids.join(",") },
      });
      const map = {};
      for (const m of data.markets || []) map[m.id] = m;
      setMarkets(map);
      setStale(Boolean(data.stale));
      setUpdatedAt(data.updatedAt || null);
      setLastFetchedAt(Date.now());
    } catch {
      // keep the last snapshot; the UI shows what it has and a delayed note
      setStale(true);
    }
  }, []);

  useEffect(() => {
    let timer = null;

    const tick = () => {
      if (document.visibilityState === "visible") fetchNow();
    };

    const start = () => {
      if (timer) return;
      timer = setInterval(tick, POLL_MS);
    };
    const stop = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        fetchNow(); // immediate refresh on focus
        start();
      } else {
        stop();
      }
    };

    // Initial fetch + start polling if visible.
    if (document.visibilityState === "visible") {
      fetchNow();
      start();
    }
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // Re-run when the set of watched ids changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, fetchNow]);

  return { markets, stale, updatedAt, lastFetchedAt, refresh: fetchNow };
}
