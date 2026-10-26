import { useEffect, useState } from "react";
import { ShieldAlert, Trash2, X } from "lucide-react";
import http from "../../api/http";
import { Button, Modal, SkeletonLines, PageHeader } from "../../components/ui";
import TokenLogo from "../../components/TokenLogo";
import CoinDetailModal from "../market/CoinDetailModal";
import { coinIdForSymbol, stableUsdPrice, isVerifiedRow } from "./usdValue";
import useDisplayCurrency from "../currency/useDisplayCurrency";

export default function HoldingDetail({ balance, chain, price, onRemove, onClose }) {
  const money = useDisplayCurrency();
  const symbol = balance.symbol;
  const verified = isVerifiedRow(balance);
  const coinId = verified ? coinIdForSymbol(symbol) : null;
  const [market, setMarket] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!coinId) return undefined;
    let active = true;
    (async () => {
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
    <Modal label={`${symbol} details`} view="token" crumb={symbol} onClose={onClose}>
      <PageHeader
        title={
          <span className="coin-title">
            <TokenLogo
              symbol={verified ? symbol : balance.address || symbol}
              size={34}
              unknown={balance.unknown}
            />
            <span>{symbol}</span>
          </span>
        }
        support={chain ? chain.name : "Unknown network"}
        action={
          <Button variant="ghost" icon title="Close" onClick={onClose}>
            <X size={16} />
          </Button>
        }
      />

      <section className="card stack">
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
                ? money.format(holding.value)
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

      </section>

      {onRemove && (
        <div className="pv-foot">
          <Button variant="danger" onClick={onRemove}>
            <Trash2 size={14} /> Remove from my wallet
          </Button>
        </div>
      )}
    </Modal>
  );
}
