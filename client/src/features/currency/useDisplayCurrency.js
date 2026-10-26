import { useCallback, useEffect, useMemo, useState } from "react";
import http from "../../api/http";
import { useAuth } from "../../context/AuthContext";
import { DEFAULT_CURRENCY, currencyOf, isDisplayCurrency } from "./currencies";
import { fallbackNote, formatMoney, resolveDisplay } from "./money";

const FRESH_MS = 5 * 60 * 1000;
const RETRY_MS = 30 * 1000;

let table = null;
let pending = null;

export function _resetFiatRatesForTests() {
  table = null;
  pending = null;
}

export async function loadFiatRates() {
  const now = Date.now();
  if (table && now - table.at < (table.error ? RETRY_MS : FRESH_MS)) return table;
  if (pending) return pending;
  pending = http
    .get("/api/prices/fiat")
    .then(({ data }) => {
      table = {
        rates: (data && data.rates) || { USD: 1 },
        stale: Boolean(data && data.stale),
        available: Boolean(data && data.available),
        error: null,
        at: Date.now(),
      };
      return table;
    })
    .catch((err) => {
      table = {
        rates: (table && table.rates) || { USD: 1 },
        stale: true,
        available: Boolean(table && table.available),
        error: (err && err.response && err.response.data && err.response.data.error) || (err && err.message) || "the server did not answer",
        at: Date.now(),
      };
      return table;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

export default function useDisplayCurrency() {
  const { user, updateProfile } = useAuth();
  const wanted = currencyOf(user);
  const [info, setInfo] = useState(() => table);

  useEffect(() => {
    if (wanted === DEFAULT_CURRENCY) return undefined;
    let live = true;
    loadFiatRates().then((t) => {
      if (live) setInfo(t);
    });
    return () => {
      live = false;
    };
  }, [wanted]);

  const loading = wanted !== DEFAULT_CURRENCY && !info;
  const display = useMemo(() => {
    const resolved = resolveDisplay(wanted, info && info.rates);
    return loading ? { ...resolved, fellBack: false } : resolved;
  }, [wanted, info, loading]);

  const format = useCallback((usd, opts) => formatMoney(usd, display, opts), [display]);

  const setCurrency = useCallback(
    async (code) => {
      if (!isDisplayCurrency(code)) throw new Error("That currency is not offered.");
      if (!updateProfile) throw new Error("You are not signed in.");
      await updateProfile({ displayCurrency: code });
    },
    [updateProfile]
  );

  return {
    ...display,
    loading,
    stale: Boolean(info && info.stale && wanted !== DEFAULT_CURRENCY && !display.fellBack),
    note: fallbackNote(display),
    format,
    setCurrency,
  };
}
