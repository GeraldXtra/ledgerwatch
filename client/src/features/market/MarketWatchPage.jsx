import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  Eye,
  Info,
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
import { tradeability } from "./tradeability";
import { fetchChains } from "../wallet/walletApi";
import { getStoredAddress } from "../wallet/keystore";
import { recallChain } from "../wallet/NetworkSwitcher";

const STARTING_CASH = 1000000;

// Deterministic tint per coinId for the allocation bar segments.
const ALLOC_COLORS = ["var(--accent-500)", "var(--accent-400)", "#8FA0B8", "#C7A98F", "#7FB39B", "#B0899E"];

function MarketWatch() {
  const { user } = useAuth();
  // Paper unless the account has deliberately switched. Server is the authority;
  // this mirrors it so the UI does not have to round-trip on every render.
  const [mode, setMode] = useState(user?.tradingMode === "live" ? "live" : "paper");
  // Live trading needs a chain and the wallet address; both are inert in paper mode.
  const [liveChains, setLiveChains] = useState([]);
  const [liveChainId, setLiveChainId] = useState(null);
  const [liveSwap, setLiveSwap] = useState(null);
  const liveChain = liveChains.find((c) => c.chainId === liveChainId) || null;
  const walletAddress = getStoredAddress();
  const toast = useToast();
  const [watches, setWatches] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [alertHistory, setAlertHistory] = useState([]);
  const [portfolio, setPortfolio] = useState(null); // raw from server (holdings qty/avg)
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [trade, setTrade] = useState(null); // { alert, side } -> opens TradePanel
  const [running, setRunning] = useState(false);
  const [detail, setDetail] = useState(null); // selected coinId for the modal
  // Shown when a notification deep link points at an alert that is already gone.
  const [deepLinkNote, setDeepLinkNote] = useState("");

  // Coins to price = union of watched coins and held coins.
  const coinIds = useMemo(() => {
    const ids = new Set(watches.map((w) => w.coinId));
    (portfolio?.holdings || []).forEach((h) => ids.add(h.coinId));
    return [...ids];
  }, [watches, portfolio]);

  const { markets, stale, lastFetchedAt } = useMarkets(coinIds);

  // Symbol -> coinId, built from what is already watched. Lets the live panel
  // price on-chain holdings from the SAME cached market data, with no second fetch.
  const coinIdBySymbol = useMemo(() => {
    const map = {};
    watches.forEach((w) => { map[String(w.symbol).toUpperCase()] = w.coinId; });
    Object.values(markets).forEach((m) => {
      if (m && m.symbol) map[String(m.symbol).toUpperCase()] = m.id;
    });
    return map;
  }, [watches, markets]);

  // Track pending-alert ids to toast when a NEW one fires while on the page.
  // Stays null until the first load resolves, which also serves as the
  // "data has arrived" signal for deep linking.
  const knownAlertIds = useRef(null);
  // Alerts the push bridge has already toasted. Both toast paths below consult
  // this so a notification and the poll cannot announce the same alert twice.
  const pushedAlertIds = useRef(new Set());

  const loadData = useCallback(async () => {
    setError("");
    try {
      /**
       * allSettled, NOT all.
       *
       * With Promise.all, ONE failing endpoint rejected the whole batch, so
       * `setPortfolio` never ran, `pf` stayed null, and the page rendered
       * skeletons forever — taking the watch form, the agent and the watch list
       * down with it. A failed alert-history call has no business blanking the
       * screen you add watches from. Each panel now succeeds or fails alone.
       */
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

      // Named, so a partial failure is visible rather than looking like empty data.
      if (failed.length) {
        setError(`Could not load ${failed.join(", ")}. The rest of the page still works.`);
      }
      if (a.status !== "fulfilled") return;

      const nextAlerts = a.value.data.alerts;
      // Toast on newly-appeared pending alerts (skip the very first load).
      if (knownAlertIds.current) {
        nextAlerts
          .filter((al) => !knownAlertIds.current.has(al._id))
          .filter((al) => !pushedAlertIds.current.has(String(al._id)))
          .forEach((al) =>
            toast(`New alert: ${al.symbol} — ${al.suggestion}`, { type: "info" })
          );
      }
      knownAlertIds.current = new Set(nextAlerts.map((al) => al._id));
      setAlerts(nextAlerts);
    } catch (err) {
      setError(err?.response?.data?.error || "Failed to load market data");
    }
  }, [toast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Chain list only matters in live mode; the same registry the wallet uses.
  useEffect(() => {
    if (mode !== "live" || liveChains.length) return;
    fetchChains()
      .then((d) => {
        const usable = (d.chains || []).filter((c) => c.testnet || d.enableMainnet);
        setLiveChains(usable);
        if (usable.length) setLiveChainId((p) => p || recallChain(usable));
      })
      .catch(() => setLiveChains([]));
  }, [mode, liveChains.length]);

  /**
   * A foreground push has already been toasted by the shell-level bridge, so this
   * only refreshes the data and REMEMBERS the alert id.
   *
   * Without that memory the 10 second poll would toast the very same alert a
   * moment later and the user would be told about it twice.
   */
  useEffect(() => {
    const onPush = (e) => {
      const p = e.detail || {};
      if (p.alertId) pushedAlertIds.current.add(String(p.alertId));
      if (p.type === "alert") loadData();
    };
    window.addEventListener("ledgerwatch:push", onPush);
    return () => window.removeEventListener("ledgerwatch:push", onPush);
  }, [loadData]);

  // Deep link from a notification's Buy/Sell button: /app/market?alert=<id>&side=buy
  // Opens the trade panel for that alert — it never executes anything, the user
  // still sets an amount and confirms.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const alertId = params.get("alert");
    const side = params.get("side");
    if (!alertId) return;
    // Wait until the first load has actually resolved, or a deep link would be
    // judged "missing" purely because the list has not arrived yet.
    if (!knownAlertIds.current) return;

    const target = alerts.find((a) => a._id === alertId);
    if (target) {
      setTrade({ alert: target, side: side === "sell" ? "sell" : "buy" });
    } else {
      // Resolved, dismissed or expired between the notification being shown and
      // the user tapping it. Say so plainly — silently doing nothing looks like
      // the button is broken.
      setDeepLinkNote(
        "That alert has already been handled, so there is nothing left to act on. Any alert still open is listed below."
      );
    }
    // Clear the params so a refresh does not reopen the panel.
    window.history.replaceState({}, "", window.location.pathname);
  }, [alerts]);

  // Poll alerts every 10s (local DB, no rate limit) to surface newly-fired alerts.
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
                // Skip anything the push bridge already announced, so an alert
                // that arrived as a notification is not toasted a second time.
                .filter((al) => !pushedAlertIds.current.has(String(al._id)))
                .forEach((al) =>
                  toast(`New alert: ${al.symbol} — ${al.suggestion}`, { type: "info" })
                );
              // a new alert means history/portfolio may change too
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

  // ---- live portfolio recompute (client-side, from live market prices) ----
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

  // ---- market rows (watched coins joined with live market data) ----
  const marketRows = useMemo(() => {
    const byCoin = {};
    for (const w of watches) byCoin[w.coinId] = (byCoin[w.coinId] || 0) + 1;
    return Object.keys(byCoin)
      .map((id) => (markets[id] ? { ...markets[id], watchCount: byCoin[id] } : null))
      .filter(Boolean);
  }, [watches, markets]);

  // ---- actions ----
  async function removeWatch(watch) {
    await http.delete(`/api/watches/${watch._id}`);
    await loadData();
  }
  async function editWatch(watch, payload) {
    await http.patch(`/api/watches/${watch._id}`, payload);
    await loadData();
  }
  // Opens the trade panel; nothing executes here. The user sets the amount and
  // confirms inside the panel.
  function openTrade(alert, side) {
    setTrade({ alert, side });
  }

  /**
   * Called by TradePanel once the user has confirmed a specific amount.
   *
   * The amount panel is identical in both modes — this is the ONLY place the two
   * diverge. Paper posts to the simulated portfolio; live hands off to the swap
   * modal, which quotes, checks and asks for a signature.
   */
  async function submitTrade({ action, amount, denom }) {
    const alert = trade.alert;

    if (mode === "live") {
      const t = tradeability(liveChain, { coinId: alert.coinId, symbol: alert.symbol }, user?.customTokens);
      if (!t.live) {
        toast(t.reason, { type: "info", duration: 9000 });
        return;
      }
      // Amount is denominated in the stablecoin for a buy, in the asset for a sell.
      setLiveSwap({
        side: action,
        coin: { coinId: alert.coinId, symbol: alert.symbol },
        token: t.token,
        cash: t.cash,
        amountDisplay: denom === "quote" ? amount : amount,
        alertId: alert._id,
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
          ? `Check complete — ${created} new alert${created === 1 ? "" : "s"}.`
          : "Check complete — no new alerts.",
        { type: created > 0 ? "info" : "success" }
      );
      await loadData();
    } catch {
      toast("Could not run the check.", { type: "error" });
    } finally {
      setRunning(false);
    }
  }

  const pf = livePortfolio;
  const up = pf ? pf.totalPnl >= 0 : true;
  const activeWatchCount = watches.filter((w) => w.active !== false).length;

  // Allocation segments. EVERY segment (holdings AND cash) is a share of the SAME
  // denominator — total portfolio value — so the bar always sums to exactly 100%.
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

  // Cash is the remainder of the same total — computed once, reused by bar + legend.
  const cashShare = pf && pf.totalValue > 0 ? (pf.cashBalance / pf.totalValue) * 100 : 0;

  /**
   * Whole-percent labels that add up to EXACTLY 100.
   *
   * The exact shares already sum to 100 (single denominator), but rounding each
   * one independently with toFixed(0) does not: 10.4 + 9.4 + 80.2 displays as
   * 10 + 9 + 80 = 99. Largest-remainder apportionment fixes it — floor every
   * share, then hand the leftover points to the segments with the biggest
   * fractional parts. The bar itself keeps the exact fractional widths.
   */
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

  const selectedMarket = detail ? markets[detail] : null;
  const detailHolding = pf?.holdings.find((h) => h.coinId === detail);
  const detailWatches = watches.filter((w) => w.coinId === detail);

  return (
    <>
      <PageHeader
        title="Market Watch"
        support={
          mode === "live"
            ? "A human-in-the-loop crypto agent: live prices, alerts you approve, and real swaps you sign yourself."
            : "A human-in-the-loop crypto agent: live prices, alerts you approve, and a fully simulated portfolio."
        }
        action={
          <>
            <Button onClick={runPass} loading={running}>
              <Zap size={14} /> {running ? "Checking" : "Check now"}
            </Button>
            <Button variant="ghost" icon title="Refresh" onClick={loadData}>
              <RefreshCw size={14} />
            </Button>
          </>
        }
      />

      <TradingModeToggle mode={mode} onChange={setMode} />

      {error && <p className="error-text">{error}</p>}

      {/* A notification pointed at an alert that has since been resolved. This is
          an ordinary outcome, not an error, so it reads as information and can be
          dismissed. */}
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

      {/* Only PAPER mode waits on the paper portfolio. It used to gate the entire
          page, so a slow or failed /api/portfolio call left live mode showing
          skeletons forever — live holdings come from the chain and have nothing
          to do with the simulated portfolio loading. */}
      {mode === "paper" && pf === null ? (
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
          {/*
            PAPER ONLY. This hero had NO mode guard at all: it rendered in live
            mode too, so switching to Live wallet still showed "Simulated
            portfolio" and the $1,000,000 paper start sitting above real funds.
            A simulated figure presented while the user believes they are looking
            at real holdings is the most dangerous thing this screen can do —
            every decision made from it would be based on money that does not
            exist. In live mode the live panel below is the ONLY portfolio shown,
            and it states its own failures rather than falling back to anything.
          */}
          {mode === "paper" && (
          <Card hero eyebrow="Portfolio" title="Simulated portfolio" subtitle="Paper trading only. Values update live as prices move.">
            <div className="hero-grid">
              <div className="hero-figure">
                <span className="overline">Total value</span>
                {/* Keyed on whole thousands, not cents: the 10s price poll nudges
                    this value constantly, and re-keying on every tick restarted
                    the flash animation forever so it never settled. */}
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

          {/* LIVE ONLY, and rendered UNCONDITIONALLY in live mode. It previously
              required `liveChain && walletAddress`, so a user with neither saw
              nothing live and only the paper hero above — which is exactly how a
              paper figure ended up representing a live wallet. The panel now owns
              its own "no wallet" / "no chain" / "unreadable" states. */}
          {mode === "live" && (
            <LivePortfolioPanel
              chain={liveChain}
              chains={liveChains}
              address={walletAddress}
              markets={markets}
              coinIdBySymbol={coinIdBySymbol}
              onPickChain={setLiveChainId}
            />
          )}

          <div className="kpi-row">
            {/* Cash / watches / alerts only change on a trade or a fired alert, so they
                count up. Total P/L is recomputed on every 10s price poll — animating it
                would restart the count from zero each tick, so it stays a plain value. */}
            {/* The two money tiles are PAPER figures — simulated cash and P/L
                against the 1,000,000 start. They are meaningless in live mode and
                actively misleading next to real holdings, so they are withheld
                rather than relabelled. Watches and alerts apply to both modes. */}
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

          <div className="split-7-5">
            <div className="stack">
              <MarketTable
                rows={marketRows}
                onSelect={(m) => setDetail(m.id)}
                live={{ lastFetchedAt, stale }}
              />
              {/* "Simulated positions" — paper only, for the same reason as the
                  hero. Live holdings are shown by LivePortfolioPanel above. */}
              {mode === "paper" && (
                <PortfolioPanel portfolio={pf} onSelect={(coinId) => setDetail(coinId)} />
              )}
              <AlertsList alerts={alerts} onTrade={openTrade} onDismiss={dismiss} busyId={busyId} />
              <AlertHistory alerts={alertHistory} />
            </div>
            <div className="stack">
              <AddWatchForm onAdded={loadData} />
              <ChatBox onAction={loadData} />
              <WatchList watches={watches} onEdit={editWatch} onRemove={removeWatch} />
            </div>
          </div>
        </>
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

      {/* The live panel now renders once, near the top, where the paper hero sits
          in paper mode — so the two can never appear together and live mode can
          never fall through to a simulated figure. */}

      {trade && (
        <TradePanel
          side={trade.side}
          alert={trade.alert}
          portfolio={pf}
          mode={mode}
          onClose={() => setTrade(null)}
          onSubmit={submitTrade}
        />
      )}

      {/* Live mode only. The amount is already chosen; this quotes it, runs the
          preflight checks and takes the signature. */}
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
          spentToday={0}
          limitOverrides={user?.tradingLimits}
          onClose={() => setLiveSwap(null)}
          onDone={() => loadData()}
        />
      )}
    </>
  );
}

// ToastProvider wraps the tab so MarketWatch (and its children) can raise toasts.
export default function MarketWatchPage() {
  return (
    <ToastProvider>
      <MarketWatch />
    </ToastProvider>
  );
}
