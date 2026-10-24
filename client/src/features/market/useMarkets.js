import { useCallback, useEffect, useRef, useState } from "react";
import http from "../../api/http";

const POLL_MS = 10000;

export default function useMarkets(coinIds) {
  const [markets, setMarkets] = useState({});
  const [stale, setStale] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [lastFetchedAt, setLastFetchedAt] = useState(null);

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
        fetchNow();
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === "visible") {
      fetchNow();
      start();
    }
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [idsKey, fetchNow]);

  return { markets, stale, updatedAt, lastFetchedAt, refresh: fetchNow };
}
