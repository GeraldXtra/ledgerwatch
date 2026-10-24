import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import http from "../../api/http";

const QUICK = ["BTC", "ETH", "SOL", "BNB", "XRP", "DOGE"];
const QUICK_IDS = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  BNB: "binancecoin",
  XRP: "ripple",
  DOGE: "dogecoin",
};

let quickCache = null;
let quickInFlight = null;

async function loadQuickMeta(http) {
  if (quickCache) return quickCache;
  if (quickInFlight) return quickInFlight;

  quickInFlight = http
    .get("/api/markets", { params: { ids: Object.values(QUICK_IDS).join(",") } })
    .then(({ data }) => {
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

export default function CoinPicker({ value, onChange }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [quick, setQuick] = useState(quickCache);
  const [quickError, setQuickError] = useState("");
  const [searchError, setSearchError] = useState("");
  const wrapRef = useRef(null);
  const debounceRef = useRef(null);

  useEffect(() => {
    let active = true;
    if (quickCache) return;
    loadQuickMeta(http)
      .then((m) => active && setQuick(m))
      .catch((err) => {
        if (active) setQuickError(err?.message || "Live prices unavailable");
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    const query = q.trim();
    if (query.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setSearchError("");
    debounceRef.current = setTimeout(async () => {
      try {
        const { data } = await http.get("/api/coins/search", { params: { q: query } });
        setResults(data.coins || []);
        setSearchError("");
        setOpen(true);
      } catch (err) {
        setResults([]);
        setSearchError(
          err?.response?.data?.error ||
            "The coin search could not be reached, so this is not a list of what exists. Try again in a moment."
        );
        setOpen(true);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [q]);

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
          ) : searchError ? (
            <div className="coin-result muted">{searchError}</div>
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
              onClick={() =>
                pick({
                  id: QUICK_IDS[sym],
                  symbol: sym,
                  name: (meta && meta.name) || sym,
                  thumb: meta && meta.image,
                })
              }
              title={meta ? `${meta.name} at $${meta.current_price}` : sym}
            >
              {sym}
            </button>
          );
        })}
      </div>

      {quickError && (
        <p className="muted caption" style={{ margin: "6px 0 0" }}>
          Live prices unavailable ({quickError}). You can still pick any coin.
        </p>
      )}
    </div>
  );
}
