import { useState } from "react";
import { Pencil, Trash2, X } from "lucide-react";
import { Button, Card, Modal, PageHeader } from "../../components/ui";
import { price as fmtPrice, compact, pct, conditionText } from "./format";
import CoinChart from "./CoinChart";
import WatchEditRow from "./WatchEditRow";

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
    <Modal
      label={`${market.name} details`}
      view="coin"
      crumb={market.name}
      onClose={onClose}
      size="lg"
    >
      <PageHeader
        title={
          <span className="coin-title">
            {market.image ? (
              <img className="coin-logo lg" src={market.image} alt="" width={34} height={34} />
            ) : (
              <span className="coin-chip">{market.symbol}</span>
            )}
            <span>
              {market.name} <span className="page-count">{market.symbol}</span>
            </span>
          </span>
        }
        support={
          market.priceUnavailable ? (
            <span className="muted small">
              Live price unavailable right now. Your watch is still active.
            </span>
          ) : (
            <span className="coin-price-line">
              <span className="coin-price num">{fmtPrice(market.current_price)}</span>
              <span className={`num ${changeCls}`}>{pct(change)} 24h</span>
            </span>
          )
        }
        action={
          <Button variant="ghost" icon title="Close" onClick={onClose}>
            <X size={16} />
          </Button>
        }
      />

      <Card title="Price">
        <CoinChart coinId={market.id} defaultDays={7} />
      </Card>

      <Card title="Details">
        <div className="detail-stats">
          {stats.map((s) => (
            <div key={s.label} className="detail-stat">
              <span className="overline">{s.label}</span>
              <span className="num">{s.value}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Your position">
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
      </Card>

      <Card title="Active watches" count={watches.length}>
        {watches.length === 0 ? (
          <p className="muted small" style={{ margin: 0 }}>
            No watches on {market.symbol} yet. Add one from the watch form.
          </p>
        ) : (
          <ul className="plain-list ruled-list">
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
                  <span>when {conditionText(w.condition)}</span>
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
      </Card>
    </Modal>
  );
}
