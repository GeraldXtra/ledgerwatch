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
import { usd, signedUsd } from "./format";
import { tokensForChain } from "./tradeability";

/**
 * The LIVE portfolio.
 *
 * Held quantities come from REAL ON-CHAIN BALANCES, never from a running total,
 * because the chain is the only thing that actually knows. Cost basis comes from
 * confirmed swap rows in WalletTx — the same records and the same reconciliation
 * the wallet already uses, not a second ledger.
 *
 * Prices come from the market data already loaded by the page. No second fetch.
 *
 * This is rendered SEPARATELY from the paper portfolio and the two are never
 * added together: one is real money and one is not, and a combined figure would
 * be meaningless at best.
 */
export default function LivePortfolioPanel({
  chain,
  chains,
  address,
  markets,
  coinIdBySymbol,
  onPickChain,
}) {
  const [rows, setRows] = useState(null);
  const [txs, setTxs] = useState([]);
  const [loading, setLoading] = useState(false);
  // Why the whole read failed, when it did. Live mode must never fall back to a
  // paper figure, so the honest alternative is to say what went wrong.
  const [loadError, setLoadError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [qr, setQr] = useState("");

  const load = useCallback(async () => {
    if (!chain || !address) return;
    setLoading(true);
    setLoadError(null);
    try {
      const history = await fetchTxs(chain.chainId).catch(() => []);
      setTxs(history);

      const provider = getProvider(chain.chainId);
      const tokens = tokensForChain(chain);

      const balances = await Promise.all(
        tokens.map(async (t) => {
          try {
            const c = new ethers.Contract(t.address, ERC20_ABI, provider);
            const bal = await c.balanceOf(address);
            return { ...t, qty: Number(ethers.formatUnits(bal, t.decimals)) };
          } catch (tokenErr) {
            // An unreadable balance is NOT a zero one. Returning 0 here meant the
            // row was then dropped by the filter below, so an RPC failure made a
            // token the user genuinely holds disappear from their portfolio
            // without a word. Kept, marked as unread, and carrying the reason.
            return { ...t, qty: null, unknown: true, reason: rpcErrorReason(tokenErr) };
          }
        })
      );
      setRows(balances.filter((b) => b.unknown || b.qty > 0));
      // Held nothing AND read nothing successfully is not the same as held
      // nothing. If every single token failed, this is a read failure, not an
      // empty wallet, and it must not be presented as one.
      if (balances.length > 0 && balances.every((b) => b.unknown)) {
        setLoadError(balances[0].reason || "balances could not be read on this network");
      }
    } catch (err) {
      setRows(null);
      setLoadError(rpcErrorReason(err) || "balances could not be read");
    } finally {
      setLoading(false);
    }
  }, [chain, address]);

  useEffect(() => {
    load();
  }, [load]);

  // Deposit QR for the zero-balance state. Same generator the wallet's Receive
  // panel uses, so the two screens cannot drift.
  useEffect(() => {
    let active = true;
    if (!address) return;
    QRCode.toDataURL(address, { width: 180, margin: 1, color: { dark: "#0A1428", light: "#FFFFFF" } })
      .then((u) => active && setQr(u))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [address]);

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — the address is on screen to copy by hand */
    }
  }

  const swaps = useMemo(
    () => txs.filter((t) => t.kind === "swap" && t.status === "confirmed"),
    [txs]
  );

  /**
   * Cost basis per symbol from confirmed swaps. A buy adds what was paid; a sell
   * releases a proportional share. Only swaps this app recorded contribute — a
   * token that arrived some other way shows a holding with no basis rather than
   * an invented one.
   */
  const basis = useMemo(() => {
    const acc = {};
    for (const s of swaps) {
      const bought = s.tokenOutSymbol;
      const spent = Number(s.value) || 0;
      const got = Number(s.amountOut) || 0;
      if (!bought || got <= 0) continue;
      if (!acc[bought]) acc[bought] = { qty: 0, cost: 0 };
      if (s.side === "buy") {
        acc[bought].qty += got;
        acc[bought].cost += spent;
      }
    }
    return acc;
  }, [swaps]);

  /**
   * ONE SYMBOL TABLE, THE SAME ONE THE WALLET USES.
   *
   * This used to strip a leading "W" and look the remainder up in a second map:
   * `symbol.toUpperCase().replace(/^W/, "")`. It worked by coincidence for WETH
   * and WBTC and broke everywhere else it mattered — WETH.e became "ETH.E" and
   * matched nothing, and it had no idea that a dollar stablecoin is a dollar, so
   * a wallet holding USDC read "No price" here even when the feed was healthy.
   *
   * `usdValue.js` already owns this mapping for the wallet. Sharing it means a
   * token cannot be priced on one screen and unpriced on the other, which is the
   * exact drift the token logo module warns about for the same reason.
   */
  const priceFor = (symbol) => {
    // A dollar stablecoin is a dollar. No feed involved, so this holds on a
    // testnet and while the price provider is unreachable.
    const stable = stableUsdPrice(symbol);
    if (stable != null) return stable;

    // The wallet's own table first, then the watch-derived one, which covers
    // coins the user searched for and added that the static map never listed.
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

  // Any holding we failed to read makes the total an understatement. Saying so
  // is the difference between a number that is incomplete and one that is wrong.
  const unreadCount = (rows || []).filter((r) => r.unknown).length;

  const explorerTx = (h) => (chain?.explorer ? `${chain.explorer}/tx/${h}` : null);

  /**
   * EVERY absent precondition gets a stated answer. This component used to
   * return null when it had no chain or no wallet, and the caller rendered it
   * conditionally on the same two things — so "live mode with no wallet" showed
   * nothing at all, leaving the paper hero as the only portfolio on screen. In
   * live mode this panel is the whole story, so it has to tell all of it.
   */
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
    return (
      <Card>
        <h3 className="section-title row">
          <Wallet size={17} /> Live positions
        </h3>
        <p className="muted small crypto-empty">
          Pick a network to see what this wallet actually holds. Balances are per network. The
          same address holds a different balance on each.
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
      <div className="row space-between">
        <div>
          <h3 className="section-title row">
            <Wallet size={17} /> Live positions
          </h3>
          <p className="muted small" style={{ margin: "2px 0 0" }}>
            Real balances held on {chain.name}, priced with live market data. Separate from your
            paper portfolio, and never added to it.
          </p>
        </div>
        <Button variant="ghost" icon title="Refresh" onClick={load}>
          <RefreshCw size={15} />
        </Button>
      </div>

      {loading && !rows ? (
        <SkeletonLines count={3} />
      ) : loadError ? (
        /* READ FAILED. Never a zero, never a paper figure — the balance is
           unknown and the only honest thing to show is why. */
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
        /* GENUINELY ZERO, and confirmed so — every token read succeeded and
           returned nothing. Made actionable rather than just stated: the address,
           a QR, and exactly what to deposit and on which network. */
        <div className="live-zero-state">
          <p className="net-scope-lead">This wallet holds nothing on {chain.name} yet</p>
          <p className="net-scope-body">
            Balance is zero, and that was read successfully rather than failing. Deposit a stablecoin{" "}
            <strong>on {chain.name}</strong> before trading. Funds sent on any other network will
            not appear here.
          </p>

          <div className="live-deposit">
            {qr && <img src={qr} alt="Wallet address QR code" className="live-qr" />}
            <div className="grow">
              <span className="overline">Your address on {chain.name}</span>
              <code className="wallet-address">{address}</code>
              <Button variant="secondary" size="sm" onClick={copyAddress}>
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? "Copied" : "Copy address"}
              </Button>
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
                // Every derived figure stays null when the quantity is unknown.
                // A value or a P&L computed from a quantity we never read would
                // be invented, and it would look exactly like a real one.
                const value = price && !r.unknown ? r.qty * price : null;
                const b = basis[r.symbol];
                const cost = !r.unknown && b && b.qty > 0 ? (b.cost / b.qty) * r.qty : null;
                const pl = value != null && cost != null ? value - cost : null;
                return (
                  <tr key={r.address}>
                    {/* The same disc the wallet draws, from the same shared
                        cache, so a token cannot appear with artwork on one
                        screen and without it on the other. An unreadable row
                        keeps the lettered disc rather than a confident brand
                        mark sitting next to "could not be read". */}
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
                    <td className="ta-right num">{price ? usd(price) : "No price"}</td>
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
                      ) : (
                        <span className="muted caption">not bought here</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
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
