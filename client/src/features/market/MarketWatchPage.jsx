import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bell, Eye, RefreshCw, TrendingDown, TrendingUp, Wallet, Zap } from "lucide-react";
import http from "../../api/http";
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
import AlertHistory from "./AlertHistory";
import PortfolioPanel from "./PortfolioPanel";

const STARTING_CASH = 1000000;

// Deterministic tint per coinId for the allocation bar segments.
const ALLOC_COLORS = ["var(--accent-500)", "var(--accent-400)", "#8FA0B8", "#C7A98F", "#7FB39B", "#B0899E"];

function MarketWatch() {
  const toast = useToast();
  const [watches, setWatches] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [alertHistory, setAlertHistory] = useState([]);
  const [portfolio, setPortfolio] = useState(null); // raw from server (holdings qty/avg)
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [running, setRunning] = useState(false);
  const [detail, setDetail] = useState(null); // selected coinId for the modal

  // Coins to price = union of watched coins and held coins.
  const coinIds = useMemo(() => {
    const ids = new Set(watches.map((w) => w.coinId));
    (portfolio?.holdings || []).forEach((h) => ids.add(h.coinId));
    return [...ids];
  }, [watches, portfolio]);

  const { markets, stale, lastFetchedAt } = useMarkets(coinIds);

  // Track pending-alert ids to toast when a NEW one fires while on the page.
  const knownAlertIds = useRef(null);

  const loadData = useCallback(async () => {
    setError("");
    try {
      const [w, a, p, h] = await Promise.all([
        http.get("/api/watches"),
        http.get("/api/alerts"),
        http.get("/api/portfolio"),
        http.get("/api/alerts/history"),
      ]);
      setWatches(w.data.watches);
      setPortfolio(p.data.portfolio);
      setAlertHistory(h.data.alerts);

      const nextAlerts = a.data.alerts;
      // Toast on newly-appeared pending alerts (skip the very first load).
      if (knownAlertIds.current) {
        const fresh = nextAlerts.filter((al) => !knownAlertIds.current.has(al._id));
        fresh.forEach((al) =>
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
              fresh.forEach((al) =>
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
  async function approve(alert) {
    setBusyId(alert._id);
    try {
      await http.patch(`/api/alerts/${alert._id}/approve`);
      toast(`Approved ${alert.symbol} ${alert.suggestion}`, { type: "success" });
      await loadData();
    } catch (err) {
      const msg = err?.response?.data?.error || "Failed to approve alert";
      setError(msg);
      toast(msg, { type: "error" });
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

  const selectedMarket = detail ? markets[detail] : null;
  const detailHolding = pf?.holdings.find((h) => h.coinId === detail);
  const detailWatches = watches.filter((w) => w.coinId === detail);

  return (
    <>
      <PageHeader
        title="Market Watch"
        support="A human-in-the-loop crypto agent: live prices, alerts you approve, and a fully simulated portfolio."
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

      {error && <p className="error-text">{error}</p>}

      {pf === null ? (
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
          {/* HERO — live portfolio value + P/L + real holdings allocation */}
          <Card hero eyebrow="Portfolio" title="Simulated portfolio" subtitle="Paper trading only. Values update live as prices move.">
            <div className="hero-grid">
              <div className="hero-figure">
                <span className="overline">Total value</span>
                <span className="hero-value num pulse" key={Math.round(pf.totalValue)}>
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
                          {seg.symbol} <span className="muted num">{seg.share.toFixed(0)}%</span>
                        </span>
                      ))}
                      <span className="alloc-legend-item">
                        <span className="alloc-dot cash" />
                        Cash <span className="muted num">{cashShare.toFixed(0)}%</span>
                      </span>
                    </div>
                  </>
                )}
              </div>
            </div>
          </Card>

          <div className="kpi-row">
            {/* Cash / watches / alerts only change on a trade or a fired alert, so they
                count up. Total P/L is recomputed on every 10s price poll — animating it
                would restart the count from zero each tick, so it stays a plain value. */}
            <StatCard label="Cash balance" countTo={pf.cashBalance} format={usd} icon={<Wallet size={17} />} hint="Uninvested simulated cash" />
            <StatCard
              label="Total P/L"
              value={signedUsd(pf.totalPnl)}
              tone={up ? "pos" : "neg"}
              icon={up ? <TrendingUp size={17} /> : <TrendingDown size={17} />}
              iconTone={up ? "pos" : "neg"}
              hint="Against the 1,000,000 start"
            />
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
              <PortfolioPanel portfolio={pf} onSelect={(coinId) => setDetail(coinId)} />
              <AlertsList alerts={alerts} onApprove={approve} onDismiss={dismiss} busyId={busyId} />
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
