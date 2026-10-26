import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ethers } from "ethers";
import { Link } from "react-router-dom";
import { ExternalLink, RefreshCw, Wallet } from "lucide-react";
import { Button, Card, SkeletonLines } from "../../components/ui";
import { getProvider, ERC20_ABI, rpcErrorReason } from "../wallet/provider";
import { coinIdForSymbol, fetchUsdPrices, stableUsdPrice } from "../wallet/usdValue";
import { fetchTxs } from "../wallet/walletApi";
import { tokensForChain, CASH_CHOICES, cashTokenFor, cashChoiceOf } from "./tradeability";
import useDisplayCurrency from "../currency/useDisplayCurrency";
import CurrencyPicker from "../currency/CurrencyPicker";
import LiveBalanceView from "./LiveBalanceView";

export default function LivePortfolioPanel({
  chain,
  chains,
  address,
  markets,
  coinIdBySymbol,
  onPickChain,
  onRows,
  reloadKey = 0,
  cashSymbol = "USDC",
  onCashSymbol,
  customTokens = [],
}) {
  const money = useDisplayCurrency();
  const [rows, setRows] = useState(null);
  const [txs, setTxs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [txError, setTxError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [quoted, setQuoted] = useState({});
  const runRef = useRef(0);

  const load = useCallback(async () => {
    if (!chain || !address) return;
    const run = ++runRef.current;
    const current = () => run === runRef.current;
    setLoading(true);
    setLoadError(null);
    try {
      let history = [];
      try {
        history = await fetchTxs(chain.chainId);
        if (!current()) return;
        setTxError(null);
      } catch (histErr) {
        history = [];
        if (!current()) return;
        setTxError(
          histErr?.response?.data?.error || histErr?.message || "the server did not answer"
        );
      }
      setTxs(history);

      const provider = getProvider(chain.chainId, { batched: true });
      const tokens = tokensForChain(chain, customTokens);

      const nativeRow = await provider
        .getBalance(address)
        .then((wei) => ({
          symbol: chain.nativeSymbol,
          address: null,
          decimals: 18,
          native: true,
          qty: Number(ethers.formatEther(wei)),
        }))
        .catch((nativeErr) => ({
          symbol: chain.nativeSymbol,
          address: null,
          decimals: 18,
          native: true,
          qty: null,
          unknown: true,
          reason: rpcErrorReason(nativeErr),
        }));

      const balances = await Promise.all(
        tokens.map(async (t) => {
          try {
            const c = new ethers.Contract(t.address, ERC20_ABI, provider);
            const bal = await c.balanceOf(address);
            return { ...t, qty: Number(ethers.formatUnits(bal, t.decimals)) };
          } catch (tokenErr) {
            return { ...t, qty: null, unknown: true, reason: rpcErrorReason(tokenErr) };
          }
        })
      );
      if (!current()) return;
      const all = [nativeRow, ...balances];
      setRows(all);
      if (onRows) onRows(balances);
      if (all.every((b) => b.unknown)) {
        setLoadError(all.find((b) => b.reason)?.reason || "balances could not be read on this network");
      }
    } catch (err) {
      if (!current()) return;
      setRows(null);
      if (onRows) onRows(null);
      setLoadError(rpcErrorReason(err) || "balances could not be read");
    } finally {
      if (current()) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chain, address, reloadKey, customTokens]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (onRows) onRows(null);
    setRows(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chain?.chainId, address]);

  const marketPrice = useCallback(
    (symbol) => {
      const stable = stableUsdPrice(symbol);
      if (stable != null) return stable;
      const coinId =
        coinIdForSymbol(symbol) || coinIdBySymbol?.[String(symbol).toUpperCase()] || null;
      const m = coinId ? markets[coinId] : null;
      return m && typeof m.current_price === "number" ? m.current_price : null;
    },
    [markets, coinIdBySymbol]
  );

  useEffect(() => {
    let live = true;
    const wanted = (rows || [])
      .filter((r) => !r.unknown && Number(r.qty) > 0 && marketPrice(r.symbol) == null)
      .map((r) => r.symbol);
    if (!wanted.length) return undefined;
    fetchUsdPrices(wanted).then((got) => {
      if (live) setQuoted((prev) => ({ ...prev, ...got }));
    });
    return () => {
      live = false;
    };
  }, [rows, marketPrice]);

  const priceFor = useCallback(
    (symbol) => {
      const p = marketPrice(symbol);
      if (p != null) return p;
      const q = quoted[String(symbol).toUpperCase()];
      return Number.isFinite(q) ? q : null;
    },
    [marketPrice, quoted]
  );

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(address);
      setCopyFailed(false);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopyFailed(true);
    }
  }

  const swaps = useMemo(
    () => txs.filter((t) => t.kind === "swap" && t.status === "confirmed"),
    [txs]
  );

  const basis = useMemo(() => {
    const acc = {};
    const oldestFirst = [...swaps].reverse();
    for (const s of oldestFirst) {
      if (s.side === "buy") {
        const bought = s.tokenOutSymbol;
        const spent = Number(s.value) || 0;
        const got = Number(s.amountOut) || 0;
        if (!bought || got <= 0) continue;
        if (!acc[bought]) acc[bought] = { qty: 0, cost: 0 };
        acc[bought].qty += got;
        acc[bought].cost += spent;
      } else if (s.side === "sell") {
        const sold = s.symbol;
        const qtySold = Number(s.value) || 0;
        const a = acc[sold];
        if (!sold || qtySold <= 0 || !a || a.qty <= 0) continue;
        const share = Math.min(1, qtySold / a.qty);
        a.cost = Math.max(0, a.cost - a.cost * share);
        a.qty = Math.max(0, a.qty - qtySold);
      }
    }
    return acc;
  }, [swaps]);

  const explorerTx = (h) => (chain?.explorer ? `${chain.explorer}/tx/${h}` : null);

  if (!address) {
    return (
      <Card>
        <h3 className="section-title row">
          <Wallet size={17} /> Live positions
        </h3>
        <p className="muted small crypto-empty">
          Live mode shows real funds held by your wallet, and this account does not have one yet.
          Create a wallet and its balances appear here. Nothing simulated is shown in live mode.
        </p>
        <Link className="btn btn-primary" to="/app/wallet">
          Create a wallet
        </Link>
      </Card>
    );
  }

  if (!chain) {
    const none = !(chains || []).length;
    return (
      <Card>
        <h3 className="section-title row">
          <Wallet size={17} /> Live positions
        </h3>
        <p className="muted small crypto-empty">
          {none
            ? "No real network is enabled on this server, so there is nothing to trade live. Set ENABLE_MAINNET=true on the server to switch the mainnets on."
            : "Pick a network to see what this wallet actually holds. Balances are per network. The same address holds a different balance on each."}
        </p>
        {(chains || []).length > 0 && onPickChain && (
          <div className="row wrap">
            {chains.map((c) => (
              <button key={c.chainId} type="button" className="chip" onClick={() => onPickChain(c.chainId)}>
                {c.name}
              </button>
            ))}
          </div>
        )}
      </Card>
    );
  }

  return (
    <Card>
      <div className="row space-between live-head">
        <div>
          <h3 className="section-title row">
            <Wallet size={17} /> Live positions
          </h3>
          <p className="muted small" style={{ margin: "2px 0 0" }}>
            Real balances held on {chain.name}, priced with live market data. Separate from your
            paper portfolio, and never added to it.
          </p>
        </div>
        <div className="row live-head-tools">
          <CurrencyPicker compact />
          {onCashSymbol && (
            <div className="seg" role="group" aria-label="Trade with" style={{ maxWidth: 180 }}>
              {CASH_CHOICES.map((choice) => {
                const tok = cashTokenFor(chain, choice);
                const present = tok && cashChoiceOf(tok) === choice;
                return (
                  <button
                    key={choice}
                    type="button"
                    className={cashSymbol === choice ? "seg-btn active" : "seg-btn"}
                    onClick={() => onCashSymbol(choice)}
                    disabled={!present}
                    title={present ? `Fund trades with ${tok.symbol}` : `${choice} is not on ${chain.name}`}
                  >
                    {choice}
                  </button>
                );
              })}
            </div>
          )}
          <Button variant="ghost" icon title="Refresh" onClick={load}>
            <RefreshCw size={15} className={loading ? "spin" : undefined} />
          </Button>
        </div>
      </div>

      {loading && !rows && !loadError ? (
        <SkeletonLines count={3} />
      ) : (
        <LiveBalanceView
          chain={chain}
          address={address}
          rows={rows || []}
          loadError={loadError}
          priceFor={priceFor}
          basis={basis}
          txError={txError}
          money={money}
          onRetry={load}
          onCopy={copyAddress}
          copied={copied}
          copyFailed={copyFailed}
        />
      )}

      {txError && (
        <p className="muted caption" style={{ marginTop: 16 }}>
          Your live trade history could not be read ({txError}), so cost and profit are not shown
          against these holdings and the list of live trades is not below. Nothing about your
          balances above depends on it.
        </p>
      )}

      {swaps.length > 0 && (
        <>
          <div className="overline" style={{ marginTop: 16 }}>Live trades</div>
          <ul className="tx-list">
            {swaps.slice(0, 8).map((s) => (
              <li key={s._id} className="row space-between crypto-tx-row">
                <div>
                  <div className="num mono-strong">
                    {s.side === "buy" ? "Bought" : s.side === "sell" ? "Sold" : "Swapped for"}{" "}
                    {Number(s.amountOut).toFixed(6)} {s.tokenOutSymbol}
                  </div>
                  <div className="muted caption">
                    for {s.value} {s.symbol}
                    {s.feeTier ? ` · ${s.feeTier / 10000}% pool` : ""}
                    {s.priceImpactPct != null ? ` · ${s.priceImpactPct.toFixed(2)}% impact` : ""}
                  </div>
                </div>
                {explorerTx(s.hash) && (
                  <a className="tx-hash-link" href={explorerTx(s.hash)} target="_blank" rel="noopener noreferrer">
                    explorer <ExternalLink size={12} />
                  </a>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
