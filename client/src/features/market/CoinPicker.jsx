import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import http from "../../api/http";

// Quick-pick chips (the common coins) shown before searching.
const QUICK = ["BTC", "ETH", "SOL", "BNB", "XRP", "DOGE"];
const QUICK_IDS = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  BNB: "binancecoin",
  XRP: "ripple",
  DOGE: "dogecoin",
};

/**
 * ONE request for all six chips, cached for the session.
 *
 * Each chip click used to trigger its own `/api/markets?ids=<one>` round trip.
 * Measured on a real account those took 4.49s, 2.94s, 1.45s, 1.07s and 913ms —
 * so a click looked dead for seconds, which is most of why the picker felt
 * broken. Six coins in one call costs the same upstream (the server caches by
 * id) and is fetched once, up front, before anybody clicks anything.
 *
 * Module-level so remounting the picker does not refetch.
 */
let quickCache = null;
let quickInFlight = null;

async function loadQuickMeta(http) {
  if (quickCache) return quickCache;
  if (quickInFlight) return quickInFlight;

  quickInFlight = http
    .get("/api/markets", { params: { ids: Object.values(QUICK_IDS).join(",") } })
    .then(({ data }) => {
      // Explicit shape check. An optional chain collapsing to undefined here
      // would leave the chips permanently unlabelled with nothing said about it.
      if (!data || !Array.isArray(data.markets)) {
        throw new Error("markets response was not in the expected shape");
      }
      const map = {};
      for (const m of data.markets) map[m.id] = m;
      quickCache = map;
      return map;
    })
    .finally(() => {
      quickInFlight = null;
    });

  return quickInFlight;
}

/**
 * Searchable coin picker. Debounced 300ms, min 2 chars, calls /api/coins/search.
 * `value` = { id, symbol, name } | null. `onChange(coin)` selects a coin.
 *
 * SELECTION NEVER WAITS ON A NETWORK CALL. A chip click sets the coin
 * synchronously; prices are prefetched once and used only as a label. This
 * matters because the picker previously appeared dead for several seconds while
 * a per-click request was in flight, which is indistinguishable from broken.
 */
export default function CoinPicker({ value, onChange }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [quick, setQuick] = useState(quickCache);
  const [quickError, setQuickError] = useState("");
  const wrapRef = useRef(null);
  const debounceRef = useRef(null);

  // Prefetch the six chip coins once, so clicking one is instant and the labels
  // can show a live price without a per-click request.
  useEffect(() => {
    let active = true;
    if (quickCache) return;
    loadQuickMeta(http)
      .then((m) => active && setQuick(m))
      .catch((err) => {
        // Never silent. The chips still WORK without prices — the price is a
        // hint, not a precondition — so this says the hint is missing rather
        // than disabling anything.
        if (active) setQuickError(err?.message || "Live prices unavailable");
      });
    return () => {
      active = false;
    };
  }, []);

  // Debounced search.
  useEffect(() => {
    clearTimeout(debounceRef.current);
    const query = q.trim();
    if (query.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const { data } = await http.get("/api/coins/search", { params: { q: query } });
        setResults(data.coins || []);
        setOpen(true);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [q]);

  // Close dropdown on outside click.
  useEffect(() => {
    function onDown(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  function pick(coin) {
    onChange(coin);
    setQ("");
    setResults([]);
    setOpen(false);
  }

  if (value) {
    return (
      <div className="coin-picked">
        {value.thumb ? (
          <img className="coin-logo" src={value.thumb} alt="" width={20} height={20} />
        ) : (
          <span className="coin-chip">{value.symbol}</span>
        )}
        <span className="picked-name">
          {value.name} <span className="muted">{value.symbol}</span>
        </span>
        <button type="button" className="btn btn-ghost btn-icon btn-sm" title="Change coin" onClick={() => onChange(null)}>
          <X size={14} />
        </button>
      </div>
    );
  }

  return (
    <div className="coin-picker" ref={wrapRef}>
      <div className="coin-search-field">
        <Search size={15} className="search-icon" />
        <input
          className="input"
          placeholder="Search any coin, e.g. bitcoin, arbitrum..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
          aria-label="Search for a coin"
        />
      </div>

      {open && (
        <div className="coin-results" role="listbox">
          {loading ? (
            <div className="coin-result muted">Searching...</div>
          ) : results.length === 0 ? (
            <div className="coin-result muted">No coins match that search.</div>
          ) : (
            results.map((c) => (
              <button
                key={c.id}
                type="button"
                role="option"
                className="coin-result"
                onClick={() => pick(c)}
              >
                {c.thumb ? (
                  <img className="coin-logo" src={c.thumb} alt="" width={20} height={20} />
                ) : (
                  <span className="coin-chip">{c.symbol}</span>
                )}
                <span className="coin-result-name">{c.name}</span>
                <span className="muted small">{c.symbol}</span>
              </button>
            ))
          )}
        </div>
      )}

      <div className="row wrap quick-chips">
        {QUICK.map((sym) => {
          const meta = quick && quick[QUICK_IDS[sym]];
          return (
            <button
              key={sym}
              type="button"
              className="chip"
              // Selection is SYNCHRONOUS and depends on nothing: no request, no
              // trading mode, no chain, no wallet. Watching a coin is not
              // trading it, so nothing about the wallet may gate this.
              onClick={() =>
                pick({
                  id: QUICK_IDS[sym],
                  symbol: sym,
                  name: (meta && meta.name) || sym,
                  thumb: meta && meta.image,
                })
              }
              title={meta ? `${meta.name} — $${meta.current_price}` : sym}
            >
              {sym}
            </button>
          );
        })}
      </div>

      {/* Says the hint is missing; never implies the chips are unusable. */}
      {quickError && (
        <p className="muted caption" style={{ margin: "6px 0 0" }}>
          Live prices unavailable ({quickError}). You can still pick any coin.
        </p>
      )}
    </div>
  );
}
