import { useEffect, useState } from "react";
import { ShieldAlert, Trash2, X } from "lucide-react";
import http from "../../api/http";
import { Button, Modal, SkeletonLines } from "../../components/ui";
import TokenLogo from "../../components/TokenLogo";
import CoinDetailModal from "../market/CoinDetailModal";
import { coinIdForSymbol, stableUsdPrice, isVerifiedRow } from "./usdValue";

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
export default function HoldingDetail({ balance, chain, price, onRemove, onClose }) {
  const symbol = balance.symbol;
  /**
   * An unverified contract is not identified by its ticker here either.
   *
   * Looking a symbol up in the coin map is what opened the full market screen —
   * chart, market cap, the day's range — for a token that merely CALLS itself
   * USDC, which is about as strong an endorsement as this app can give. A token
   * the owner imported or accepted from the discovery list gets the plain
   * "no market data" panel and its contract address instead.
   */
  const verified = isVerifiedRow(balance);
  const coinId = verified ? coinIdForSymbol(symbol) : null;
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
  const usd = verified ? (Number.isFinite(price) ? price : stableUsdPrice(symbol)) : null;
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
          {/* Keyed on the contract for an unverified token, so a borrowed
              ticker cannot pull the genuine coin's artwork in here. */}
          <TokenLogo
            symbol={verified ? symbol : balance.address || symbol}
            size={34}
            unknown={balance.unknown}
          />
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
      {!coinId && verified && (
        <p className="muted small" style={{ marginTop: 12 }}>
          This token is not listed on the price feed, so there is no chart or market data for it.
          The balance is read directly from the chain.
        </p>
      )}
      {!verified && (
        <p className="against-note" style={{ marginTop: 12 }}>
          <ShieldAlert size={15} />
          <span>
            This token is not one {chain ? chain.name : "this network"} has verified. It was added
            from its contract address, and the name and symbol above are whatever that contract
            reports, which anybody can choose. It is deliberately given no dollar value here and
            is not counted in your wallet total. Check the contract on the explorer before
            trusting it.
          </span>
        </p>
      )}

      {onRemove && (
        <div className="row" style={{ justifyContent: "flex-end", marginTop: 14 }}>
          <Button variant="danger" size="sm" onClick={onRemove}>
            <Trash2 size={14} /> Remove from my wallet
          </Button>
        </div>
      )}
    </Modal>
  );
}
