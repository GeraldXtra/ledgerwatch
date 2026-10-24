import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import http from "../../api/http";
import CoinImage from "../../components/CoinImage";

const QUICK_LIMIT = 30;

let quickCache = null;
let quickInFlight = null;

async function loadQuickMeta(http) {
  if (quickCache) return quickCache;
  if (quickInFlight) return quickInFlight;

  quickInFlight = http
    .get("/api/coins/top", { params: { limit: QUICK_LIMIT } })
    .then(({ data }) => {
      if (!data || !Array.isArray(data.coins)) {
        throw new Error("the popular coins answer was not in the expected shape");
      }
      const coins = data.coins.filter((c) => c && c.id && c.symbol);
      const result = { coins, stale: Boolean(data.stale), fallback: Boolean(data.fallback) };
      if (!result.fallback) quickCache = result;
      return result;
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
        const coins = data.coins || [];
        setResults(coins);
        setSearchError(
          coins.length === 0 && data.stale
            ? "The coin search could not reach the price feed just now, so this is not a list of what exists. Try again in a moment."
            : ""
        );
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
        <CoinImage src={value.thumb} symbol={value.symbol} size={20} />
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
                <CoinImage src={c.thumb} symbol={c.symbol} size={20} />
                <span className="coin-result-name">{c.name}</span>
                <span className="muted small">{c.symbol}</span>
              </button>
            ))
          )}
        </div>
      )}

      <div className="row wrap quick-chips">
        {(quick ? quick.coins : []).map((coin) => (
          <button
            key={coin.id}
            type="button"
            className="chip coin-quick"
            onClick={() =>
              pick({
                id: coin.id,
                symbol: coin.symbol,
                name: coin.name || coin.symbol,
                thumb: coin.image,
              })
            }
            title={
              coin.current_price != null ? `${coin.name} at $${coin.current_price}` : coin.name || coin.symbol
            }
          >
            <CoinImage src={coin.image} symbol={coin.symbol} size={16} quiet />
            {coin.symbol}
          </button>
        ))}
      </div>

      {quickError && (
        <p className="muted caption" style={{ margin: "6px 0 0" }}>
          The popular coins could not be loaded ({quickError}). Search for any coin above.
        </p>
      )}
      {quick && quick.fallback && (
        <p className="muted caption" style={{ margin: "6px 0 0" }}>
          Live prices are unavailable, so this is a fixed list of popular coins. Search finds any other.
        </p>
      )}
    </div>
  );
}
