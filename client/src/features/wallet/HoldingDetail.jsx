import { useEffect, useState } from "react";
import { X } from "lucide-react";
import http from "../../api/http";
import { Button, Modal, SkeletonLines } from "../../components/ui";
import TokenLogo from "../../components/TokenLogo";
import CoinDetailModal from "../market/CoinDetailModal";
import { coinIdForSymbol, stableUsdPrice } from "./usdValue";

/**
 * What opens when a wallet row is clicked.
 *
 * For any token the price feed knows, this is the same coin detail the market
 * screen shows: chart with timeframes, market cap, volume, the day's range, and
 * the position, with the quantity taken from the chain rather than a simulated
 * book. It is deliberately the SAME component, so a coin cannot be described
 * two different ways on two screens.
 *
 * For a token the feed does not list, usually one the owner added by contract
 * address, there is no chart to show, so this renders what is actually known:
 * the network, the balance read from the chain, its value if a price exists,
 * and the contract. It says plainly that there is no market data rather than
 * showing an empty chart frame.
 */
export default function HoldingDetail({ balance, chain, price, onClose }) {
  const symbol = balance.symbol;
  const coinId = coinIdForSymbol(symbol);
  const [market, setMarket] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!coinId) return undefined;
    let active = true;
    (async () => {
      // Same retry shape as the chart: the server fills its cache on demand, so
      // the first answer for a coin can be empty while that fill is in flight.
      for (let attempt = 0; attempt <= 3; attempt++) {
        try {
          const { data } = await http.get("/api/markets", { params: { ids: coinId } });
          const m = (data.markets || [])[0];
          if (!active) return;
          if (m) {
            setMarket(m);
            return;
          }
        } catch {
          if (!active) return;
        }
        if (attempt === 3) {
          if (active) setFailed(true);
          return;
        }
        await new Promise((r) => setTimeout(r, 2500 * Math.pow(2, attempt)));
        if (!active) return;
      }
    })();
    return () => {
      active = false;
    };
  }, [coinId]);

  const qty = balance.unknown ? null : Number(balance.amount);
  const usd = Number.isFinite(price) ? price : stableUsdPrice(symbol);
  const holding =
    qty != null
      ? { qty, avgBuyPrice: null, value: Number.isFinite(usd) ? qty * usd : null }
      : null;

  if (coinId && market) {
    return (
      <CoinDetailModal
        market={market}
        holding={holding}
        watches={[]}
        onClose={onClose}
        onEditWatch={() => {}}
        onRemoveWatch={() => {}}
      />
    );
  }

  const loading = Boolean(coinId) && !failed;

  return (
    <Modal label={`${symbol} details`} onClose={onClose}>
      <div className="row space-between coin-detail-head">
        <div className="row">
          <TokenLogo symbol={symbol} size={34} unknown={balance.unknown} />
          <div>
            <h3 className="section-title">{symbol}</h3>
            <div className="muted caption">{chain ? chain.name : "Unknown network"}</div>
          </div>
        </div>
        <Button variant="ghost" icon title="Close" onClick={onClose}>
          <X size={16} />
        </Button>
      </div>

      {loading ? (
        <SkeletonLines count={4} />
      ) : (
        <dl className="trade-quote">
          <div>
            <dt>Balance</dt>
            <dd className="num">
              {qty != null
                ? `${qty.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${symbol}`
                : "Could not be read"}
            </dd>
          </div>
          <div>
            <dt>Value</dt>
            <dd className="num">
              {holding && holding.value != null
                ? `$${holding.value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`
                : "No price"}
            </dd>
          </div>
          {balance.address && (
            <div>
              <dt>Contract</dt>
              <dd>
                <code className="wallet-address">{balance.address}</code>
              </dd>
            </div>
          )}
        </dl>
      )}

      {coinId && failed && (
        <p className="muted small" style={{ marginTop: 12 }}>
          Market data for {symbol} did not load. The balance above is read from the chain and is
          correct regardless.
        </p>
      )}
      {!coinId && (
        <p className="muted small" style={{ marginTop: 12 }}>
          This token is not listed on the price feed, so there is no chart or market data for it.
          The balance is read directly from the chain.
        </p>
      )}
    </Modal>
  );
}
