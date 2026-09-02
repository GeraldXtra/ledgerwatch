import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, LineChart } from "lucide-react";
import { Card, EmptyState } from "../../components/ui";
import { pct } from "./format";
import AnimatedPrice from "./AnimatedPrice";
import Sparkline from "./Sparkline";
import LiveIndicator from "./LiveIndicator";

const SORTS = {
  name: (a, b) => (a.name || a.symbol).localeCompare(b.name || b.symbol),
  price: (a, b) => (a.current_price || 0) - (b.current_price || 0),
  change: (a, b) =>
    (a.price_change_percentage_24h || 0) - (b.price_change_percentage_24h || 0),
};

/**
 * Live watched-coin table: logo, name/symbol, live (animated) price, 24h change,
 * inline 7d sparkline. Sortable by name / price / 24h change. Clicking a row opens
 * the coin detail modal. `rows` = [{ ...market, watchCount }].
 */
export default function MarketTable({ rows, onSelect, live }) {
  const [sort, setSort] = useState("change");
  const [dir, setDir] = useState("desc");

  const sorted = useMemo(() => {
    const cmp = SORTS[sort] || SORTS.change;
    const out = [...rows].sort(cmp);
    if (dir === "desc") out.reverse();
    return out;
  }, [rows, sort, dir]);

  function toggle(key) {
    if (sort === key) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSort(key);
      setDir(key === "name" ? "asc" : "desc");
    }
  }

  const arrow = (key) =>
    sort === key ? (
      dir === "asc" ? (
        <ArrowUp size={12} />
      ) : (
        <ArrowDown size={12} />
      )
    ) : null;

  return (
    <Card
      eyebrow="Market"
      title="Watchlist"
      subtitle="Live prices for the coins you follow. Click a coin for its chart and details."
      action={live && <LiveIndicator lastFetchedAt={live.lastFetchedAt} stale={live.stale} />}
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<LineChart size={20} />}
          title="Nothing on your watchlist"
          hint="Add a coin below and its live price, 24h move and 7-day trend will appear here."
        />
      ) : (
        <div className="table-wrap">
          <table className="table table-stack market-table">
            <thead>
              <tr>
                <th>
                  <button type="button" className="th-sort" onClick={() => toggle("name")}>
                    Coin {arrow("name")}
                  </button>
                </th>
                <th className="ta-right">
                  <button type="button" className="th-sort right" onClick={() => toggle("price")}>
                    Price {arrow("price")}
                  </button>
                </th>
                <th className="ta-right">
                  <button type="button" className="th-sort right" onClick={() => toggle("change")}>
                    24h {arrow("change")}
                  </button>
                </th>
                <th className="ta-right sparkline-col">7d</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((m) => {
                const change = m.price_change_percentage_24h;
                const changeCls = change == null ? "" : change >= 0 ? "value-pos" : "value-neg";
                return (
                  <tr
                    key={m.id}
                    className="clickable-row"
                    onClick={() => onSelect(m)}
                    tabIndex={0}
                    role="button"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelect(m);
                      }
                    }}
                  >
                    <td data-label="Coin">
                      <div className="cell-lead">
                        {m.image ? (
                          <img className="coin-logo" src={m.image} alt="" width={24} height={24} />
                        ) : (
                          <span className="coin-chip">{m.symbol}</span>
                        )}
                        <div>
                          <div className="lead-name">{m.symbol}</div>
                          <div className="lead-sub">
                            {m.name}
                            {m.watchCount > 1 ? ` · ${m.watchCount} watches` : ""}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td data-label="Price" align="right" className="ta-right num">
                      {/* An unreadable price says so. It used to be dropped from
                          the table entirely, which read as "you follow no coins"
                          rather than "the feed is down". */}
                      {m.priceUnavailable ? (
                        <span className="muted small" title="The price feed did not answer for this coin. Your watch is still active.">
                          Unavailable
                        </span>
                      ) : (
                        <AnimatedPrice value={m.current_price} />
                      )}
                    </td>
                    <td data-label="24h" align="right" className={`ta-right num ${changeCls}`}>
                      {pct(change)}
                    </td>
                    <td data-label="7d" align="right" className="ta-right sparkline-col">
                      <Sparkline data={m.sparkline} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
