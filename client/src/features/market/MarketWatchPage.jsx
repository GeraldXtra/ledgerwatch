import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Bell,
  Eye,
  Info,
  Plus,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  Wallet,
  X,
  Zap,
} from "lucide-react";
import http from "../../api/http";
import { useAuth } from "../../context/AuthContext";
import {
  Button,
  Card,
  Modal,
  PageHeader,
  SkeletonBlock,
  StatCard,
  ToastProvider,
  useToast,
} from "../../components/ui";
import { usd, signedUsd, pct } from "./format";
import useMarkets from "./useMarkets";
import MarketTable from "./MarketTable";
import CoinDetailModal from "./CoinDetailModal";
import AddWatchForm from "./AddWatchForm";
import ChatBox from "./ChatBox";
import WatchList from "./WatchList";
import AlertsList from "./AlertsList";
import TradePanel from "./TradePanel";
import AlertHistory from "./AlertHistory";
import PortfolioPanel from "./PortfolioPanel";
import TradingModeToggle from "./TradingModeToggle";
import LiveSwapModal from "./LiveSwapModal";
import LivePortfolioPanel from "./LivePortfolioPanel";
import { resolveTradeable } from "./resolveTradeable";
import { toSpendAmount } from "./amount";
import { fetchChains, fetchSpend24h } from "../wallet/walletApi";
import { getStoredAddress } from "../wallet/keystore";
import { coinIdForSymbol, stableUsdPrice } from "../wallet/usdValue";
import { recallChain } from "../wallet/NetworkSwitcher";

const STARTING_CASH = 1000000;

const MARKET_VIEWS = ["alerts", "watchlist", "portfolio"];

const MARKET_PARENT = {
  buy: "alerts",
  sell: "alerts",
  swap: "alerts",
  coin: "watchlist",
  watch: "watchlist",
};

const ALLOC_COLORS = [
  "var(--accent-500)",
  "var(--accent-400)",
  "var(--chart-alloc-3)",
  "var(--chart-alloc-4)",
  "var(--chart-alloc-5)",
  "var(--chart-alloc-6)",
];

function MarketWatch() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const wantedView = params.get("view");
  const lastView = useRef("alerts");
  const view = MARKET_VIEWS.includes(wantedView)
    ? wantedView
    : MARKET_PARENT[wantedView] || (wantedView ? lastView.current : "alerts");
  lastView.current = view;
  const [mode, setMode] = useState(user?.tradingMode === "live" ? "live" : "paper");
  const [liveChains, setLiveChains] = useState([]);
  const [liveChainId, setLiveChainId] = useState(null);
  const [liveSwap, setLiveSwap] = useState(null);
  const [liveRows, setLiveRows] = useState(null);
  const [liveReloadKey, setLiveReloadKey] = useState(0);
  const [spentToday, setSpentToday] = useState(null);
  const [spendError, setSpendError] = useState("");
  const [spendReload, setSpendReload] = useState(0);
  const [cashSymbol, setCashSymbol] = useState(() => {
    try {
      const v = localStorage.getItem("ledgerwatch.live.cash");
      return v === "USDT" ? "USDT" : "USDC";
    } catch {
      return "USDC";
    }
  });
  function chooseCash(next) {
    const v = next === "USDT" ? "USDT" : "USDC";
    setCashSymbol(v);
    try {
      localStorage.setItem("ledgerwatch.live.cash", v);
    } catch {
    }
  }
  const liveChain = liveChains.find((c) => c.chainId === liveChainId) || null;
  const walletAddress = getStoredAddress();
  const toast = useToast();
  const [watches, setWatches] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [alertHistory, setAlertHistory] = useState([]);
  const [portfolio, setPortfolio] = useState(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [trade, setTrade] = useState(null);
  const [running, setRunning] = useState(false);
  const [detail, setDetail] = useState(null);
  const [deepLinkNote, setDeepLinkNote] = useState("");
  const [addingWatch, setAddingWatch] = useState(false);

  const coinIds = useMemo(() => {
    const ids = new Set(watches.map((w) => w.coinId));
    (portfolio?.holdings || []).forEach((h) => ids.add(h.coinId));
    return [...ids];
  }, [watches, portfolio]);

  const { markets, stale, lastFetchedAt } = useMarkets(coinIds);

  const coinIdBySymbol = useMemo(() => {
    const map = {};
    watches.forEach((w) => { map[String(w.symbol).toUpperCase()] = w.coinId; });
    Object.values(markets).forEach((m) => {
      if (m && m.symbol) map[String(m.symbol).toUpperCase()] = m.id;
    });
    return map;
  }, [watches, markets]);

  const knownAlertIds = useRef(null);
  const pushedAlertIds = useRef(new Set());

  const loadData = useCallback(async () => {
    setError("");
    try {
      const [w, a, p, h] = await Promise.allSettled([
        http.get("/api/watches"),
        http.get("/api/alerts"),
        http.get("/api/portfolio"),
        http.get("/api/alerts/history"),
      ]);

      const failed = [];
      if (w.status === "fulfilled") setWatches(w.value.data.watches);
      else failed.push("watches");
      if (p.status === "fulfilled") setPortfolio(p.value.data.portfolio);
      else failed.push("portfolio");
      if (h.status === "fulfilled") setAlertHistory(h.value.data.alerts);
      else failed.push("alert history");
      if (a.status !== "fulfilled") failed.push("alerts");

      if (failed.length) {
        setError(`Could not load ${failed.join(", ")}. The rest of the page still works.`);
      }
      if (a.status !== "fulfilled") return;

      const nextAlerts = a.value.data.alerts;
      if (knownAlertIds.current) {
        nextAlerts
          .filter((al) => !knownAlertIds.current.has(al._id))
          .filter((al) => !pushedAlertIds.current.has(String(al._id)))
          .forEach((al) =>
            toast(`New alert on ${al.symbol}. The agent suggests ${al.suggestion}.`, { type: "info" })
          );
      }
      knownAlertIds.current = new Set(nextAlerts.map((al) => al._id));
      setAlerts(nextAlerts);
    } catch (err) {
      setError(err?.response?.data?.error || "Failed to load market data");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast, mode]);

  useEffect(() => {
    setWatches([]);
    setAlerts([]);
    setAlertHistory([]);
    setPortfolio(null);
    knownAlertIds.current = null;
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (mode !== "live" || liveChains.length) return;
    fetchChains()
      .then((d) => {
        const mainnets = (d.chains || []).filter((c) => !c.testnet && d.enableMainnet);
        setLiveChains(mainnets);
        if (mainnets.length) {
          setLiveChainId((p) => {
            if (p && mainnets.some((c) => c.chainId === p)) return p;
            const recalled = recallChain(mainnets);
            return mainnets.some((c) => c.chainId === recalled) ? recalled : mainnets[0].chainId;
          });
        }
      })
      .catch(() => setLiveChains([]));
  }, [mode, liveChains.length]);

  useEffect(() => {
    if (!liveSwap) return undefined;
    let alive = true;
    setSpentToday(null);
    setSpendError("");
    fetchSpend24h()
      .then((n) => alive && setSpentToday(n))
      .catch((err) => {
        if (!alive) return;
        setSpentToday(null);
        setSpendError(
          err?.response?.data?.error || err?.message || "the server did not answer"
        );
      });
    return () => {
      alive = false;
    };
  }, [liveSwap, spendReload]);

  useEffect(() => {
    const onPush = (e) => {
      const p = e.detail || {};
      if (p.alertId) pushedAlertIds.current.add(String(p.alertId));
      if (p.type === "alert") loadData();
    };
    window.addEventListener("ledgerwatch:push", onPush);
    return () => window.removeEventListener("ledgerwatch:push", onPush);
  }, [loadData]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const alertId = params.get("alert");
    const side = params.get("side");
    if (!alertId) return;
    if (!knownAlertIds.current) return;

    const target = alerts.find((a) => a._id === alertId);
    if (target) {
      setTrade({ alert: target, side: side === "sell" ? "sell" : "buy" });
    } else {
      setDeepLinkNote(
        "That alert has already been handled, so there is nothing left to act on. Any alert still open is listed below."
      );
    }
    window.history.replaceState({}, "", window.location.pathname);
  }, [alerts]);

  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      http
        .get("/api/alerts")
        .then(({ data }) => {
          const nextAlerts = data.alerts;
          if (knownAlertIds.current) {
            const fresh = nextAlerts.filter((al) => !knownAlertIds.current.has(al._id));
            if (fresh.length) {
              fresh
                .filter((al) => !pushedAlertIds.current.has(String(al._id)))
                .forEach((al) =>
                  toast(`New alert on ${al.symbol}. The agent suggests ${al.suggestion}.`, { type: "info" })
                );
              http.get("/api/alerts/history").then((h) => setAlertHistory(h.data.alerts)).catch(() => {});
            }
          }
          knownAlertIds.current = new Set(nextAlerts.map((al) => al._id));
          setAlerts(nextAlerts);
        })
        .catch(() => {});
    }, 10000);
    return () => clearInterval(t);
  }, [toast]);

  const livePortfolio = useMemo(() => {
    if (!portfolio) return null;
    let holdingsValue = 0;
    const holdings = (portfolio.holdings || []).map((h) => {
      const m = markets[h.coinId];
      const price = m && typeof m.current_price === "number" ? m.current_price : h.price;
      const value = price != null ? h.qty * price : h.value;
      if (value != null) holdingsValue += value;
      return { ...h, price, value };
    });
    const cashBalance = portfolio.cashBalance;
    const totalValue = cashBalance + holdingsValue;
    return {
      cashBalance,
      holdings,
      holdingsValue,
      totalValue,
      totalPnl: totalValue - STARTING_CASH,
    };
  }, [portfolio, markets]);

  const marketRows = useMemo(() => {
    const byCoin = {};
    for (const w of watches) {
      if (!byCoin[w.coinId]) byCoin[w.coinId] = { count: 0, symbol: w.symbol };
      byCoin[w.coinId].count += 1;
    }
    return Object.entries(byCoin).map(([id, { count, symbol }]) => {
      const m = markets[id];
      if (m) return { ...m, watchCount: count };
      return {
        id,
        symbol: String(symbol || id).toUpperCase(),
        name: String(id)
          .split("-")
          .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
          .join(" "),
        image: null,
        current_price: null,
        price_change_percentage_24h: null,
        sparkline: [],
        watchCount: count,
        priceUnavailable: true,
      };
    });
  }, [watches, markets]);

  async function removeWatch(watch) {
    try {
      await http.delete(`/api/watches/${watch._id}`);
      await loadData();
    } catch (err) {
      toast(
        err?.response?.data?.error ||
          `${watch.symbol} could not be removed from your watchlist. It is still being watched.`,
        { type: "error", duration: 9000 }
      );
    }
  }
  async function editWatch(watch, payload) {
    await http.patch(`/api/watches/${watch._id}`, payload);
    await loadData();
  }
  function openTrade(alert, side) {
    setTrade({ alert, side });
  }

  async function submitTrade({ action, amount, denom }) {
    const alert = trade.alert;

    if (mode === "live") {
      if (!walletAddress) {
        return {
          ok: false,
          message:
            "This browser does not hold your wallet keys, so a live trade cannot be signed here. " +
            "Import your wallet with its recovery phrase on the Wallet page, or switch back to paper.",
        };
      }
      if (!liveChain) {
        return {
          ok: false,
          message:
            "No real network is selected, so there is nothing to trade on. Pick one in Live positions above.",
        };
      }
      const t = await resolveTradeable({
        chain: liveChain,
        coin: { coinId: alert.coinId, symbol: alert.symbol },
        customTokens: user?.customTokens,
        preferredCash: cashSymbol,
      });
      if (!t.live) {
        return { ok: false, message: t.reason };
      }
      const conv = toSpendAmount({
        action,
        denom,
        amount,
        price: Number(alert.priceAtAlert) || 0,
      });
      if (!conv.ok) {
        return {
          ok: false,
          message:
            conv.reason === "no-price"
              ? "No live price for that coin right now, so the amount cannot be converted safely."
              : "That amount could not be worked out. Please enter it again.",
        };
      }

      setLiveSwap({
        side: action,
        coin: { coinId: alert.coinId, symbol: alert.symbol },
        token: t.token,
        cash: t.cash,
        amountDisplay: conv.amount,
        typed: { amount: Number(amount), denom, price: Number(alert.priceAtAlert) || 0 },
        alertId: alert._id,
        warnings: t.warnings || [],
      });
      setTrade(null);
      return;
    }

    setBusyId(alert._id);
    try {
      const { data } = await http.post(`/api/alerts/${alert._id}/act`, {
        action,
        amount,
        denom,
      });
      const against = data.alert.suggestion !== action ? " (against the agent's suggestion)" : "";
      toast(`${action === "buy" ? "Bought" : "Sold"} ${alert.symbol}${against}`, {
        type: "success",
      });
      setTrade(null);
      await loadData();
    } finally {
      setBusyId(null);
    }
  }
  async function dismiss(alert) {
    setBusyId(alert._id);
    try {
      await http.patch(`/api/alerts/${alert._id}/dismiss`);
      await loadData();
    } catch (err) {
      toast(
        err?.response?.data?.error ||
          `That alert could not be dismissed, so it is still waiting for your decision.`,
        { type: "error", duration: 9000 }
      );
    } finally {
      setBusyId(null);
    }
  }
  async function runPass() {
    setRunning(true);
    try {
      const { data } = await http.post("/api/automation/run");
      const created = data.alertsCreated ?? 0;
      toast(
        created > 0
          ? `Check complete. ${created} new alert${created === 1 ? "" : "s"}.`
          : "Check complete. Nothing new.",
        { type: created > 0 ? "info" : "success" }
      );
      await loadData();
    } catch {
      toast("Could not run the check.", { type: "error" });
    } finally {
      setRunning(false);
    }
  }

  const livePortfolioReal = useMemo(() => {
    if (mode !== "live") return null;
    const all = liveRows || [];
    const rows = all.filter((r) => !r.unknown && Number(r.qty) > 0);
    const isCash = (sym) =>
      cashSymbol === "USDT"
        ? /^(USDT|USD₮0|USDT0|USDt)$/i.test(sym)
        : /^USDC$/i.test(sym);
    const cashRowAny = all.find((r) => isCash(r.symbol));
    let holdingsValue = 0;
    const holdings = rows
      .filter((r) => !isCash(r.symbol))
      .map((r) => {
        const coinId =
          coinIdForSymbol(r.symbol) || coinIdBySymbol?.[String(r.symbol).toUpperCase()] || null;
        const m = coinId ? markets[coinId] : null;
        const price =
          m && typeof m.current_price === "number" ? m.current_price : stableUsdPrice(r.symbol);
        const qty = Number(r.qty);
        const value = Number.isFinite(price) ? qty * price : null;
        if (value != null) holdingsValue += value;
        return { coinId, symbol: r.symbol, qty, price, value, avgBuyPrice: null };
      });
    const cashUnknown = liveRows == null || Boolean(cashRowAny && cashRowAny.unknown);
    const cashBalance = cashUnknown ? null : cashRowAny ? Number(cashRowAny.qty) : 0;
    return {
      real: true,
      cashSymbol,
      cashBalance,
      cashUnknown,
      cashUnknownReason:
        (cashRowAny && cashRowAny.reason) ||
        (liveRows == null ? "the balances on this network have not been read yet" : null),
      holdings,
      holdingsValue,
      totalValue: cashUnknown ? null : cashBalance + holdingsValue,
      totalPnl: null,
    };
  }, [mode, liveRows, cashSymbol, coinIdBySymbol, markets]);

  const pf = mode === "live" ? livePortfolioReal : livePortfolio;
  const up = pf && pf.totalPnl != null ? pf.totalPnl >= 0 : true;
  const activeWatchCount = watches.filter((w) => w.active !== false).length;

  const allocation = useMemo(() => {
    if (!pf || pf.totalValue <= 0) return [];
    return pf.holdings
      .filter((h) => h.value > 0)
      .sort((a, b) => b.value - a.value)
      .map((h, i) => ({
        symbol: h.symbol,
        value: h.value,
        share: (h.value / pf.totalValue) * 100,
        color: ALLOC_COLORS[i % ALLOC_COLORS.length],
      }));
  }, [pf]);

  const cashShare = pf && pf.totalValue > 0 ? (pf.cashBalance / pf.totalValue) * 100 : 0;

  const allocLabels = useMemo(() => {
    const parts = [
      ...allocation.map((h) => ({ key: h.symbol, share: h.share })),
      { key: "__cash", share: cashShare },
    ];
    const floors = parts.map((p) => Math.floor(p.share));
    let leftover = 100 - floors.reduce((a, b) => a + b, 0);

    const byFrac = parts
      .map((p, i) => ({ i, frac: p.share - Math.floor(p.share) }))
      .sort((a, b) => b.frac - a.frac);

    const out = [...floors];
    for (let k = 0; k < byFrac.length && leftover > 0; k++, leftover--) {
      out[byFrac[k].i] += 1;
    }

    const map = {};
    parts.forEach((p, i) => {
      map[p.key] = out[i];
    });
    return map;
  }, [allocation, cashShare]);

  const selectedMarket = detail
    ? markets[detail] || marketRows.find((r) => r.id === detail) || null
    : null;
  const detailHolding = pf?.holdings.find((h) => h.coinId === detail);
  const detailWatches = watches.filter((w) => w.coinId === detail);

  const actions = (
    <>
      <Button variant="ghost" icon title="Refresh" onClick={loadData}>
        <RefreshCw size={14} />
      </Button>
      <Button variant="primary" onClick={runPass} loading={running}>
        <Zap size={14} /> {running ? "Checking" : "Check now"}
      </Button>
    </>
  );

  const waiting = mode === "paper" && pf === null;

  return (
    <>
      <div className="page-stack subtab-panel market-view" hidden={view !== "alerts"}>
        <PageHeader title="Alerts" action={actions} />

        {error && <p className="error-text">{error}</p>}

        {deepLinkNote && (
          <div className="row space-between deeplink-note">
            <span className="row">
              <Info size={15} />
              {deepLinkNote}
            </span>
            <Button variant="ghost" icon title="Dismiss" onClick={() => setDeepLinkNote("")}>
              <X size={15} />
            </Button>
          </div>
        )}

        {waiting ? (
          <SkeletonBlock height={280} />
        ) : (
          <>
            <AlertsList alerts={alerts} onTrade={openTrade} onDismiss={dismiss} busyId={busyId} />
            <AlertHistory alerts={alertHistory} />
          </>
        )}
      </div>

      <div className="page-stack subtab-panel market-view" hidden={view !== "watchlist"}>
        {error && <p className="error-text">{error}</p>}

        {waiting ? (
          <SkeletonBlock height={280} />
        ) : (
          <>
            <MarketTable
              rows={marketRows}
              onSelect={(m) => setDetail(m.id)}
              live={{ lastFetchedAt, stale }}
              action={
                <Button variant="primary" onClick={() => setAddingWatch(true)}>
                  <Plus size={14} /> Add watch
                </Button>
              }
            />
            <WatchList watches={watches} onEdit={editWatch} onRemove={removeWatch} />
          </>
        )}
      </div>

      <div className="page-stack subtab-panel" hidden={view !== "portfolio"}>
        <PageHeader
          title="Market Watch"
          support={
            mode === "live"
              ? "Live prices, alerts that wait for your answer, and swaps you sign yourself."
              : "Live prices, alerts that wait for your answer, and a portfolio that is entirely simulated."
          }
          action={actions}
        />

        <section className="card">
          <TradingModeToggle mode={mode} onChange={setMode} />
        </section>

        {error && <p className="error-text">{error}</p>}

        {waiting ? (
          <>
            <SkeletonBlock height={150} />
            <div className="kpi-row">
              <SkeletonBlock height={110} />
              <SkeletonBlock height={110} />
              <SkeletonBlock height={110} />
              <SkeletonBlock height={110} />
            </div>
            <SkeletonBlock height={280} />
          </>
        ) : (
          <>
            {mode === "paper" && (
            <Card hero eyebrow="Portfolio" title="Simulated portfolio" subtitle="Paper trading only. Values update live as prices move.">
              <div className="hero-grid">
                <div className="hero-figure">
                  <span className="overline">Total value</span>
                  <span className="hero-value num pulse" key={Math.floor(pf.totalValue / 1000)}>
                    {usd(pf.totalValue)}
                  </span>
                  <span className={`hero-pl ${up ? "pos" : "neg"}`}>
                    {up ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                    {signedUsd(pf.totalPnl)}
                    <span className="muted small" style={{ marginLeft: 4 }}>
                      ({pct((pf.totalPnl / STARTING_CASH) * 100)})
                    </span>
                  </span>
                  <span className="stat-hint">Cash plus live holdings, vs the 1,000,000 start</span>
                </div>

                <div className="alloc-block">
                  <span className="overline">Allocation</span>
                  {allocation.length === 0 ? (
                    <p className="muted small" style={{ margin: "8px 0 0" }}>
                      No holdings yet. Approve a buy alert to open your first position.
                    </p>
                  ) : (
                    <>
                      <div className="alloc-bar" role="img" aria-label="Holdings allocation">
                        {allocation.map((seg) => (
                          <span
                            key={seg.symbol}
                            className="alloc-seg"
                            style={{ width: `${seg.share}%`, background: seg.color }}
                            title={`${seg.symbol} ${seg.share.toFixed(1)}%`}
                          />
                        ))}
                        <span
                          className="alloc-seg cash"
                          style={{ width: `${cashShare}%` }}
                          title={`Cash ${cashShare.toFixed(1)}%`}
                        />
                      </div>
                      <div className="alloc-legend">
                        {allocation.map((seg) => (
                          <span key={seg.symbol} className="alloc-legend-item">
                            <span className="alloc-dot" style={{ background: seg.color }} />
                            {seg.symbol} <span className="muted num">{allocLabels[seg.symbol]}%</span>
                          </span>
                        ))}
                        <span className="alloc-legend-item">
                          <span className="alloc-dot cash" />
                          Cash <span className="muted num">{allocLabels.__cash}%</span>
                        </span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </Card>
            )}

            {mode === "live" && (
              <LivePortfolioPanel
                chain={liveChain}
                chains={liveChains}
                address={walletAddress}
                markets={markets}
                coinIdBySymbol={coinIdBySymbol}
                onPickChain={setLiveChainId}
                onRows={setLiveRows}
                reloadKey={liveReloadKey}
                cashSymbol={cashSymbol}
                onCashSymbol={chooseCash}
                customTokens={user?.customTokens}
              />
            )}

            <div className="kpi-row">
              {mode === "paper" && (
                <>
                  <StatCard label="Cash balance" countTo={pf.cashBalance} format={usd} icon={<Wallet size={17} />} hint="Uninvested simulated cash" />
                  <StatCard
                    label="Total P/L"
                    value={signedUsd(pf.totalPnl)}
                    tone={up ? "pos" : "neg"}
                    icon={up ? <TrendingUp size={17} /> : <TrendingDown size={17} />}
                    iconTone={up ? "pos" : "neg"}
                    hint="Against the 1,000,000 start"
                  />
                </>
              )}
              <StatCard label="Active watches" countTo={activeWatchCount} icon={<Eye size={17} />} hint="Checked on every pass" />
              <StatCard
                label="Pending alerts"
                countTo={alerts.length}
                iconTone={alerts.length > 0 ? "neg" : "neutral"}
                icon={<Bell size={17} />}
                hint="Awaiting your approval"
              />
            </div>

            {mode === "paper" && (
              <PortfolioPanel portfolio={pf} onSelect={(coinId) => setDetail(coinId)} />
            )}

            <ChatBox onAction={loadData} />
          </>
        )}
      </div>

      {addingWatch && (
        <Modal label="Watch a coin" view="watch" onClose={() => setAddingWatch(false)}>
          <AddWatchForm onAdded={loadData} onCancel={() => setAddingWatch(false)} />
        </Modal>
      )}

      {selectedMarket && (
        <CoinDetailModal
          market={selectedMarket}
          holding={detailHolding}
          watches={detailWatches}
          onClose={() => setDetail(null)}
          onEditWatch={editWatch}
          onRemoveWatch={removeWatch}
        />
      )}

      {trade && (
        <TradePanel
          busyLabel={mode === "live" ? "Checking the contract…" : undefined}
          side={trade.side}
          alert={trade.alert}
          portfolio={pf}
          currentPrice={markets?.[trade.alert.coinId]?.current_price}
          onClose={() => setTrade(null)}
          onSubmit={submitTrade}
        />
      )}

      {liveSwap && liveChain && walletAddress && (
        <LiveSwapModal
          chain={liveChain}
          address={walletAddress}
          side={liveSwap.side}
          coin={liveSwap.coin}
          token={liveSwap.token}
          cash={liveSwap.cash}
          amountDisplay={liveSwap.amountDisplay}
          alertId={liveSwap.alertId}
          spentToday={spentToday}
          spentTodayError={spendError}
          onRetrySpentToday={() => setSpendReload((n) => n + 1)}
          resolveWarnings={liveSwap.warnings}
          limitOverrides={user?.tradingLimits}
          onClose={() => setLiveSwap(null)}
          onDone={() => {
            loadData();
            setLiveReloadKey((k) => k + 1);
          }}
        />
      )}
    </>
  );
}

export default function MarketWatchPage() {
  return (
    <ToastProvider>
      <MarketWatch />
    </ToastProvider>
  );
}
