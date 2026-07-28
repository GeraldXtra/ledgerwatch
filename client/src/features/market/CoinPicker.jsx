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
 * Searchable coin picker. Debounced 300ms, min 2 chars, calls /api/coins/search.
 * `value` = { id, symbol, name } | null. `onChange(coin)` selects a coin.
 */
export default function CoinPicker({ value, onChange }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef(null);
  const debounceRef = useRef(null);

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
        {QUICK.map((sym) => (
          <button
            key={sym}
            type="button"
            className="chip"
            onClick={() => pick({ id: QUICK_IDS[sym], symbol: sym, name: sym })}
          >
            {sym}
          </button>
        ))}
      </div>
    </div>
  );
}
