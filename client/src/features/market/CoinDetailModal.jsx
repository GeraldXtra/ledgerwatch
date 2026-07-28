import { useState } from "react";
import { Pencil, Trash2, X } from "lucide-react";
import { Button, Modal } from "../../components/ui";
import { price as fmtPrice, compact, pct, conditionText } from "./format";
import CoinChart from "./CoinChart";
import WatchEditRow from "./WatchEditRow";

/**
 * Coin detail modal: large real chart with timeframes, key stats (24h high/low,
 * market cap, volume), the user's holding of the coin, and its active watches
 * (editable / removable). Full-screen on mobile via CSS.
 */
export default function CoinDetailModal({
  market,
  holding,
  watches,
  onClose,
  onEditWatch,
  onRemoveWatch,
}) {
  const [editingId, setEditingId] = useState(null);
  const change = market.price_change_percentage_24h;
  const changeCls = change == null ? "" : change >= 0 ? "value-pos" : "value-neg";

  const stats = [
    { label: "Market cap", value: compact(market.market_cap) },
    { label: "24h volume", value: compact(market.total_volume) },
    { label: "24h high", value: fmtPrice(market.high_24h) },
    { label: "24h low", value: fmtPrice(market.low_24h) },
  ];

  return (
    <Modal label={`${market.name} details`} onClose={onClose} size="lg">
      <div className="row space-between coin-detail-head">
        <div className="row">
          {market.image ? (
            <img className="coin-logo lg" src={market.image} alt="" width={34} height={34} />
          ) : (
            <span className="coin-chip">{market.symbol}</span>
          )}
          <div>
            <h3 className="section-title">
              {market.name} <span className="muted">{market.symbol}</span>
            </h3>
            <div className="row" style={{ gap: 8 }}>
              <span className="mono-strong num" style={{ fontSize: 18 }}>
                {fmtPrice(market.current_price)}
              </span>
              <span className={`num small ${changeCls}`}>{pct(change)} 24h</span>
            </div>
          </div>
        </div>
        <Button variant="ghost" icon title="Close" onClick={onClose}>
          <X size={16} />
        </Button>
      </div>

      <CoinChart coinId={market.id} defaultDays={7} />

      <div className="detail-stats">
        {stats.map((s) => (
          <div key={s.label} className="detail-stat">
            <span className="overline">{s.label}</span>
            <span className="num mono-strong">{s.value}</span>
          </div>
        ))}
      </div>

      <div className="detail-section">
        <span className="overline">Your position</span>
        {holding ? (
          <div className="detail-holding">
            <span className="num">
              {holding.qty.toLocaleString("en-US", { maximumFractionDigits: 6 })} {market.symbol}
            </span>
            <span className="muted small num">avg {fmtPrice(holding.avgBuyPrice)}</span>
            <span className="mono-strong num">
              {holding.value != null ? fmtPrice(holding.value) : "--"}
            </span>
          </div>
        ) : (
          <p className="muted small" style={{ margin: 0 }}>
            You hold no {market.symbol}. Approve a buy alert to open a position.
          </p>
        )}
      </div>

      <div className="detail-section">
        <span className="overline">Active watches</span>
        {watches.length === 0 ? (
          <p className="muted small" style={{ margin: 0 }}>
            No watches on {market.symbol} yet. Add one from the watch form.
          </p>
        ) : (
          <ul className="plain-list">
            {watches.map((w) =>
              editingId === w._id ? (
                <li key={w._id} className="list-row">
                  <WatchEditRow
                    watch={w}
                    onCancel={() => setEditingId(null)}
                    onSave={async (payload) => {
                      await onEditWatch(w, payload);
                      setEditingId(null);
                    }}
                  />
                </li>
              ) : (
                <li key={w._id} className="row space-between list-row">
                  <span className="small" style={{ color: "var(--ink)" }}>
                    when {conditionText(w.condition)}
                  </span>
                  <div className="row">
                    <Button variant="ghost" size="sm" icon title="Edit condition" onClick={() => setEditingId(w._id)}>
                      <Pencil size={13} />
                    </Button>
                    <Button variant="ghost" size="sm" icon title="Remove watch" onClick={() => onRemoveWatch(w)}>
                      <Trash2 size={13} />
                    </Button>
                  </div>
                </li>
              )
            )}
          </ul>
        )}
      </div>
    </Modal>
  );
}
