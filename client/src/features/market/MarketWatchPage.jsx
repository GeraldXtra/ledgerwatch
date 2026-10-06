import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
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
import { DetailPane } from "../../components/ui/Modal";
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

// Deterministic tint per coinId for the allocation bar segments.
// Every allocation colour is a theme token; the last four used to be literal
// hex and did not follow the dark theme.
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
  const view = MARKET_VIEWS.includes(wantedView) ? wantedView : "alerts";
  // Paper unless the account has deliberately switched. Server is the authority;
  // this mirrors it so the UI does not have to round-trip on every render.
  const [mode, setMode] = useState(user?.tradingMode === "live" ? "live" : "paper");
  // Live trading needs a chain and the wallet address; both are inert in paper mode.
  const [liveChains, setLiveChains] = useState([]);
  const [liveChainId, setLiveChainId] = useState(null);
  const [liveSwap, setLiveSwap] = useState(null);
  // The on chain balances the live panel read, reported upward so the trade
  // panel's ceiling is the wallet's real holdings and not an empty document.
  const [liveRows, setLiveRows] = useState(null);
  // Bumped after a swap lands so the live panel rereads the chain.
  const [liveReloadKey, setLiveReloadKey] = useState(0);
  // Dollars already spent on live swaps in the last 24h, read from the server
  // each time a swap is opened. `null` means "not known", and the swap modal
  // waits for a number rather than assuming zero.
  const [spentToday, setSpentToday] = useState(null);
  // Why that figure is missing, when it is. `spentToday === null` on its own
  // means two different things — "not asked yet" and "asked and it failed" — and
  // the swap modal used to render the loading state for both, forever. See the
  // effect below.
  const [spendError, setSpendError] = useState("");
  // Bumped to ask the server for the daily spend again after a failure.
  const [spendReload, setSpendReload] = useState(0);
  // Which dollar funds live trades. Remembered per browser.
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
      /* private mode: lasts for this page */
    }
  }
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
            toast(`New alert on ${al.symbol}. The agent suggests ${al.suggestion}.`, { type: "info" })
          );
      }
      knownAlertIds.current = new Set(nextAlerts.map((al) => al._id));
      setAlerts(nextAlerts);
    } catch (err) {
      setError(err?.response?.data?.error || "Failed to load market data");
    }
    // `mode` is a dependency because the server now scopes watches, alerts and
    // the portfolio to the book you are in — it is read from the session, not
    // from this closure, which is why the linter cannot see the link. Without it
    // the paper rows stayed on screen after switching to live, so the live
    // wallet showed watches nobody had added to it. Suppressed deliberately
    // rather than left as a standing warning.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast, mode]);

  useEffect(() => {
    /**
     * Clear the previous book BEFORE fetching the next one. Leaving the old rows
     * up during the round trip shows paper positions under a live heading, which
     * is the one thing this separation exists to prevent.
     */
    setWatches([]);
    setAlerts([]);
    setAlertHistory([]);
    setPortfolio(null);
    knownAlertIds.current = null;
    loadData();
  }, [loadData]);

  /**
   * LIVE MEANS MAINNET. NOTHING ELSE.
   *
   * This used to admit every enabled chain, testnets included, and then
   * recalled whichever chain the wallet last used. The wallet had last been on
   * Base Sepolia, so the "Live wallet" opened on a test network and showed 160
   * test USDC as if it were money. Real funds only: testnets are filtered out
   * here, and the recalled chain is used only if it is a mainnet.
   *
   * With mainnet disabled on the server the list is empty and the live section
   * says so, rather than quietly falling back to a testnet.
   */
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

  /**
   * THE DAILY CAP IS MEASURED, NOT ASSUMED.
   *
   * `spentToday` was hardcoded to 0 here, so `spentToday + spend > perDay`
   * reduced to `spend > perDay`, which the per trade cap already blocks. The
   * daily limit therefore never fired: a runaway loop could execute unlimited
   * trades at the per trade cap. The figure now comes from the server, which
   * sums every swap this account signed in the last twenty four hours across
   * every chain, and is refetched every time a swap is opened.
   */
  /**
   * AND A FIGURE THAT COULD NOT BE READ SAYS SO (LW-037's shape, again).
   *
   * The catch here set `spentToday` back to null, which is also its value while
   * the request is in flight. The swap modal refuses to plan without the number
   * — correctly — and rendered four grey bars while it waited, so a failed
   * request left the money dialog on the loading state permanently: no error, no
   * retry, no explanation, and nothing to press but the close cross. The reason
   * is now carried separately from the value, so "we are asking" and "we asked
   * and it failed" are two different states on screen.
   */
  useEffect(() => {
    if (!liveSwap) return undefined;
    let alive = true;
    setSpentToday(null);
    setSpendError("");
    fetchSpend24h()
      .then((n) => alive && setSpentToday(n))
      // Unknown is not zero. The value stays null so nothing plans against an
      // assumed zero, and the reason is what the modal shows instead.
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
                  toast(`New alert on ${al.symbol}. The agent suggests ${al.suggestion}.`, { type: "info" })
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
  /**
   * A WATCHED COIN KEEPS ITS ROW EVEN WITH NO MARKET DATA.
   *
   * This used to drop any coin the markets map did not cover, so when the price
   * feed was unavailable the table emptied and the screen read "Nothing on your
   * watchlist" — telling the owner they had added no coins when what had
   * actually happened was that the upstream went quiet. Hard rule 4: a value we
   * could not read is shown as unknown, never as absent, and never as zero.
   *
   * The watch document carries the coin id and symbol, so the row can always be
   * drawn. Only the live figures are missing, and `priceUnavailable` says which.
   */
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
        // "matic-network" reads as a database key, not a coin. Title-cased so a
        // row waiting on the price feed still looks like part of the product.
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

  // ---- actions ----
  /**
   * A REFUSED DELETE USED TO LOOK LIKE A DEAD BUTTON (LW-028).
   *
   * This had no catch, and both call sites — the cross in the watch list and the
   * bin in the coin detail dialog — invoke it from a raw onClick that throws the
   * promise away. So with the server down or the session expired the row simply
   * stayed where it was, with nothing said anywhere, and the natural response is
   * to press it again. The neighbouring edit-watch button already reported its
   * reason; this one now does too.
   */
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
   *
   * A REFUSAL IS RETURNED, NOT JUST TOASTED. Every "no" below used to `return`
   * plainly, which resolved the promise TradePanel was awaiting exactly as a
   * success does. TradePanel only cleared its busy flag in its catch, so the
   * dialog froze on "Checking the contract…" with Back greyed out as well: the
   * user was left with a stuck box and a toast that vanished. The reason now
   * comes back to the panel, which shows it where the user is already looking
   * and hands them their typed amount back.
   */
  async function submitTrade({ action, amount, denom }) {
    const alert = trade.alert;

    if (mode === "live") {
      /**
       * THE TWO THINGS THE SWAP DIALOG CANNOT BE DRAWN WITHOUT.
       *
       * The dialog is rendered only when both a mainnet and a readable wallet
       * address exist, but this function set it up and closed the amount panel
       * unconditionally. Trading mode is stored on the account, so the page can
       * open in live mode in a browser whose keystore was cleared or corrupted —
       * `hasWallet()` only checks the raw string is there while
       * `getStoredAddress()` returns null if it will not parse. Pressing Confirm
       * then closed the panel and nothing else happened at all: the button that
       * spends money did nothing, silently, which invites a second press.
       */
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
      /**
       * AWAITED, BECAUSE THE ANSWER IS NO LONGER ONLY LOCAL.
       *
       * This used to be a synchronous lookup against the registry, which holds
       * about a dozen assets, so almost every coin a person searched for came
       * back "paper only". `resolveTradeable` still answers instantly from the
       * registry and from the user's own tokens; only when neither knows the
       * coin does it ask the server, which finds the contract in the coin index
       * and reads `symbol()` and `decimals()` off the chain before agreeing it
       * is real. TradePanel is already awaiting this call, so the wait shows as
       * its own busy state rather than as a frozen button.
       */
      const t = await resolveTradeable({
        chain: liveChain,
        coin: { coinId: alert.coinId, symbol: alert.symbol },
        customTokens: user?.customTokens,
        preferredCash: cashSymbol, // the dollar the owner chose to fund trades with
      });
      if (!t.live) {
        return { ok: false, message: t.reason };
      }
      // LW-008. The conversion lives in ./amount so it can be tested; it was
      // inline here as a ternary with two identical branches, which is exactly
      // why nobody spotted it. See __tests__/LW-008.test.js.
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
        // Carried so the confirm screen can restate what the user actually typed
        // alongside what will be spent, rather than silently showing a different
        // number from the one they entered.
        typed: { amount: Number(amount), denom, price: Number(alert.priceAtAlert) || 0 },
        alertId: alert._id,
        /**
         * WHERE THE ADDRESS CAME FROM TRAVELS WITH THE ADDRESS.
         *
         * These were raised as toasts here instead — eleven seconds of pop-up,
         * fired before the confirm screen had even opened, saying that this
         * contract calls itself something other than the listing does or shares
         * its ticker with a different verified token. By the time the owner was
         * actually looking at the address and deciding whether to tick the box,
         * the sentence explaining why they should look had gone. It is carried
         * to the confirm screen and shown beside the address, which is what
         * `resolveTradeable` always said happened.
         */
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
  // try/finally with no catch is the same silence as no handler at all: the
  // spinner stopped and the alert stayed on the list with nothing said (LW-028).
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

  /**
   * THE LIVE BOOK IS THE CHAIN, NOT A DOCUMENT.
   *
   * The server creates a Portfolio document for live mode with cashBalance 0
   * and no holdings, on purpose, so simulated money never sits beside real
   * funds. But that document was then handed to the trade panel as the ceiling
   * for what could be spent, and to the allocation bar as what was held. So in
   * live mode the Review button could never enable and the allocation was
   * always empty: the real wallet held USDC and WBTC, and the app was looking
   * at an empty ledger entry instead.
   *
   * Built here from the balances the live panel reads off the chain. Cash is
   * the chosen dollar's balance on the selected network. Holdings are every
   * other token with a quantity, valued at the live price where one exists.
   * There is no P&L: this book records what is held now, not what was paid.
   */
  /**
   * A BALANCE THAT COULD NOT BE READ IS NOT A BALANCE OF ZERO — INCLUDING THE
   * DOLLAR ONE (hard rule 4).
   *
   * The panel above goes to some trouble to keep the distinction: a token whose
   * `balanceOf` failed comes back as `{ qty: null, unknown: true }` with the
   * reason on it. This function then dropped every unknown row and, when the
   * stablecoin was one of them, recorded the ceiling as `0`. The trade panel
   * showed "Available: $0" and refused every buy with "That is more than your
   * available cash ($0)" — a flat statement that the owner has no money, made
   * because one RPC call did not answer. Blocking is the right direction;
   * saying why is the part that was missing.
   *
   * `cashBalance` is now null when it is not known, and `cashUnknown` carries
   * the reason. `liveRows === null` — the panel has not reported yet, or its
   * whole read failed — is the same kind of not-known and is treated the same.
   */
  const livePortfolioReal = useMemo(() => {
    if (mode !== "live") return null;
    const all = liveRows || [];
    const rows = all.filter((r) => !r.unknown && Number(r.qty) > 0);
    const isCash = (sym) =>
      cashSymbol === "USDT"
        ? /^(USDT|USD₮0|USDT0|USDt)$/i.test(sym)
        : /^USDC$/i.test(sym);
    // Searched across EVERY row, not only the readable ones, so an unreadable
    // stablecoin is found rather than looking like an absent one.
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
    // Not known: the panel has reported nothing yet, or the dollar's own
    // balance call failed. Zero is only claimed when a read actually returned it.
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
      // An unknown dollar balance makes the total an understatement rather than
      // a figure, so it is not asserted either.
      totalValue: cashUnknown ? null : cashBalance + holdingsValue,
      totalPnl: null,
    };
  }, [mode, liveRows, cashSymbol, coinIdBySymbol, markets]);

  const pf = mode === "live" ? livePortfolioReal : livePortfolio;
  const up = pf && pf.totalPnl != null ? pf.totalPnl >= 0 : true;
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

  /**
   * Falls back to the row the table drew.
   *
   * Reading only from `markets` meant that when the price feed was down a click
   * did nothing at all — no modal, no explanation. The placeholder row above
   * carries enough to open the modal and say what is missing, and the chart
   * fetches independently, so it may well have history even when the live quote
   * does not.
   */
  const selectedMarket = detail
    ? markets[detail] || marketRows.find((r) => r.id === detail) || null
    : null;
  const detailHolding = pf?.holdings.find((h) => h.coinId === detail);
  const detailWatches = watches.filter((w) => w.coinId === detail);

  const actions = (
    <>
      <Button variant="primary" onClick={runPass} loading={running}>
        <Zap size={14} /> {running ? "Checking" : "Check now"}
      </Button>
      <Button variant="ghost" icon title="Refresh" onClick={loadData}>
        <RefreshCw size={14} />
      </Button>
    </>
  );

  const waiting = mode === "paper" && pf === null;

  return (
    <>
      <div className="subtab-panel ws-view market-view" hidden={view !== "alerts"}>
        <PageHeader title="Alerts" action={actions} />

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

        {waiting ? (
          <SkeletonBlock height={280} />
        ) : (
          <>
            <AlertsList alerts={alerts} onTrade={openTrade} onDismiss={dismiss} busyId={busyId} />
            <AlertHistory alerts={alertHistory} />
          </>
        )}
      </div>

      <div className="subtab-panel ws-view market-view" hidden={view !== "watchlist"}>
        {error && <p className="error-text">{error}</p>}

        {waiting ? (
          <SkeletonBlock height={280} />
        ) : (
          <>
            <MarketTable
              rows={marketRows}
              onSelect={(m) => setDetail(m.id)}
              live={{ lastFetchedAt, stale }}
            />
            <WatchList watches={watches} onEdit={editWatch} onRemove={removeWatch} />
          </>
        )}
      </div>

      <div className="stack subtab-panel" hidden={view !== "portfolio"}>
        <PageHeader
          title="Market Watch"
          support={
            mode === "live"
              ? "Live prices, alerts that wait for your answer, and swaps you sign yourself."
              : "Live prices, alerts that wait for your answer, and a portfolio that is entirely simulated."
          }
          action={actions}
        />

        <TradingModeToggle mode={mode} onChange={setMode} />

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
            {/*
              PAPER ONLY. This hero had NO mode guard at all: it rendered in live
              mode too, so switching to Live wallet still showed "Simulated
              portfolio" and the $1,000,000 paper start sitting above real funds.
              A simulated figure presented while the user believes they are looking
              at real holdings is the most dangerous thing this screen can do,
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
                nothing live and only the paper hero above, which is exactly how a
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
                onRows={setLiveRows}
                reloadKey={liveReloadKey}
                cashSymbol={cashSymbol}
                onCashSymbol={chooseCash}
                customTokens={user?.customTokens}
              />
            )}

            <div className="kpi-row">
              {/* Cash / watches / alerts only change on a trade or a fired alert, so they
                  count up. Total P/L is recomputed on every 10s price poll, so animating it
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

            {/* "Simulated positions" — paper only, for the same reason as the
                hero. Live holdings are shown by LivePortfolioPanel above. */}
            {mode === "paper" && (
              <PortfolioPanel portfolio={pf} onSelect={(coinId) => setDetail(coinId)} />
            )}

            <ChatBox onAction={loadData} />
          </>
        )}
      </div>

      {!waiting && (
        <DetailPane screen="inline" active={view === "watchlist"}>
          <AddWatchForm onAdded={loadData} />
        </DetailPane>
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
          in paper mode, so the two can never appear together and live mode can
          never fall through to a simulated figure. */}

      {/* In live mode `pf` is the real on chain book, so the ceiling here is
          what the wallet actually holds on the selected mainnet. */}
      {trade && (
        <TradePanel
          busyLabel={mode === "live" ? "Checking the contract…" : undefined}
          side={trade.side}
          alert={trade.alert}
          portfolio={pf}
          // The price NOW, from the same feed the table renders. Without it the
          // panel priced the trade at whatever the coin cost when the alert
          // fired, which may be hours old. See the note in TradePanel.
          currentPrice={markets?.[trade.alert.coinId]?.current_price}
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
          spentToday={spentToday}
          spentTodayError={spendError}
          onRetrySpentToday={() => setSpendReload((n) => n + 1)}
          resolveWarnings={liveSwap.warnings}
          limitOverrides={user?.tradingLimits}
          onClose={() => setLiveSwap(null)}
          onDone={() => {
            loadData();
            // The swap moved real tokens in this wallet. Reread the chain so the
            // live book, the ceiling and the allocation all show the new state.
            setLiveReloadKey((k) => k + 1);
          }}
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
