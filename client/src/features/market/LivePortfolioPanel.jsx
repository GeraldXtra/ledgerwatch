import { useCallback, useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import QRCode from "qrcode";
import { Link } from "react-router-dom";
import { AlertTriangle, Check, Copy, ExternalLink, RefreshCw, Wallet } from "lucide-react";
import { Button, Card, SkeletonLines } from "../../components/ui";
import TokenLogo from "../../components/TokenLogo";
import { getProvider, ERC20_ABI, rpcErrorReason } from "../wallet/provider";
import { coinIdForSymbol, stableUsdPrice } from "../wallet/usdValue";
import { fetchTxs } from "../wallet/walletApi";
import { usd, signedUsd, price as fmtPrice } from "./format";
import { tokensForChain, CASH_CHOICES, cashTokenFor, cashChoiceOf } from "./tradeability";

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
  const [rows, setRows] = useState(null);
  const [txs, setTxs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [txError, setTxError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [qr, setQr] = useState("");
  const [qrFailed, setQrFailed] = useState(false);

  const load = useCallback(async () => {
    if (!chain || !address) return;
    setLoading(true);
    setLoadError(null);
    try {
      let history = [];
      try {
        history = await fetchTxs(chain.chainId);
        setTxError(null);
      } catch (histErr) {
        history = [];
        setTxError(
          histErr?.response?.data?.error || histErr?.message || "the server did not answer"
        );
      }
      setTxs(history);

      const provider = getProvider(chain.chainId);
      const tokens = tokensForChain(chain, customTokens);

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
      setRows(balances.filter((b) => b.unknown || b.qty > 0));
      if (onRows) onRows(balances);
      if (balances.length > 0 && balances.every((b) => b.unknown)) {
        setLoadError(balances[0].reason || "balances could not be read on this network");
      }
    } catch (err) {
      setRows(null);
      if (onRows) onRows(null);
      setLoadError(rpcErrorReason(err) || "balances could not be read");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chain, address, reloadKey, customTokens]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (onRows) onRows(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chain?.chainId, address]);

  useEffect(() => {
    let active = true;
    if (!address) return;
    setQrFailed(false);
    QRCode.toDataURL(address, { width: 180, margin: 1, color: { dark: "#0A1428", light: "#FFFFFF" } })
      .then((u) => active && setQr(u))
      .catch(() => active && setQrFailed(true));
    return () => {
      active = false;
    };
  }, [address]);

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

  const priceFor = (symbol) => {
    const stable = stableUsdPrice(symbol);
    if (stable != null) return stable;

    const coinId =
      coinIdForSymbol(symbol) || coinIdBySymbol?.[String(symbol).toUpperCase()] || null;
    const m = coinId ? markets[coinId] : null;
    return m && typeof m.current_price === "number" ? m.current_price : null;
  };

  const totalValue = (rows || []).reduce((sum, r) => {
    if (r.unknown) return sum;
    const p = priceFor(r.symbol);
    return sum + (p ? r.qty * p : 0);
  }, 0);

  const unreadCount = (rows || []).filter((r) => r.unknown).length;

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
        <div className="row" style={{ gap: 8, alignItems: "center" }}>
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
            <RefreshCw size={15} />
          </Button>
        </div>
      </div>

      {loading && !rows ? (
        <SkeletonLines count={3} />
      ) : loadError ? (
        <div className="live-read-error">
          <AlertTriangle size={16} />
          <div>
            <p className="net-scope-lead">Balances on {chain.name} could not be read</p>
            <p className="net-scope-body">
              {loadError}. This is a connection problem rather than a zero balance, so your funds are
              unaffected. Nothing simulated is shown in live mode, so nothing is shown here.
            </p>
            <Button variant="secondary" size="sm" onClick={load}>
              <RefreshCw size={14} /> Try again
            </Button>
          </div>
        </div>
      ) : !rows || rows.length === 0 ? (
        <div className="live-zero-state">
          <p className="net-scope-lead">This wallet holds nothing on {chain.name} yet</p>
          <p className="net-scope-body">
            Balance is zero, and that was read successfully rather than failing. Deposit a stablecoin{" "}
            <strong>on {chain.name}</strong> before trading. Funds sent on any other network will
            not appear here.
          </p>

          <div className="live-deposit">
            {qr && <img src={qr} alt="Wallet address QR code" className="live-qr" />}
            {!qr && qrFailed && <p className="error-text">The QR code could not be drawn. Copy the address instead.</p>}
            <div className="grow">
              <span className="overline">Your address on {chain.name}</span>
              <code className="wallet-address">{address}</code>
              <Button variant="secondary" size="sm" onClick={copyAddress}>
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? "Copied" : "Copy address"}
              </Button>
              {copyFailed && <p className="error-text">Your browser blocked copying. Select the address and copy it by hand.</p>}
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="live-total">
            <span className="overline">Held value</span>
            <span className="num figure-xl">{usd(totalValue)}</span>
            {unreadCount > 0 && (
              <span className="muted caption">
                Excludes {unreadCount} holding{unreadCount === 1 ? "" : "s"} that could not be read
                so the real total is higher.
              </span>
            )}
          </div>

          <div className="table-wrap">
          <table className="table compact">
            <thead>
              <tr>
                <th>Asset</th>
                <th className="ta-right">Held</th>
                <th className="ta-right">Price</th>
                <th className="ta-right">Value</th>
                <th className="ta-right">Cost basis</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const price = priceFor(r.symbol);
                const value = price && !r.unknown ? r.qty * price : null;
                const b = basis[r.symbol];
                const cost = !r.unknown && b && b.qty > 0 ? (b.cost / b.qty) * r.qty : null;
                const pl = value != null && cost != null ? value - cost : null;
                return (
                  <tr key={r.address}>
                    <td>
                      <span className="cell-lead">
                        <TokenLogo symbol={r.symbol} size={22} unknown={r.unknown} />
                        {r.symbol}
                      </span>
                    </td>
                    <td className="ta-right num">
                      {r.unknown ? (
                        <span className="muted caption">could not be read</span>
                      ) : (
                        r.qty.toLocaleString(undefined, { maximumFractionDigits: 6 })
                      )}
                    </td>
                    <td className="ta-right num">{price ? fmtPrice(price) : "No price"}</td>
                    <td className="ta-right num">{value != null ? usd(value) : "Not counted"}</td>
                    <td className="ta-right num">
                      {cost != null ? (
                        <>
                          {usd(cost)}
                          {pl != null && (
                            <span className={pl >= 0 ? "value-pos" : "value-neg"}>
                              {" "}
                              {signedUsd(pl)}
                            </span>
                          )}
                        </>
                      ) : txError ? (
                        <span className="muted caption">history not read</span>
                      ) : (
                        <span className="muted caption">not bought here</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </>
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
                    {s.side === "buy" ? "Bought" : "Sold"} {Number(s.amountOut).toFixed(6)}{" "}
                    {s.tokenOutSymbol}
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
