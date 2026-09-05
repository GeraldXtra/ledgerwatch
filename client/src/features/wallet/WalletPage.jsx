import { useCallback, useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import {
  ArrowDownToLine,
  ArrowUpRight,
  Check,
  Copy,
  History,
  Inbox,
  PlusCircle,
  DownloadCloud,
  RefreshCw,
  Trash2,
  TriangleAlert,
  Wallet as WalletIcon,
  X,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Button, Card, SkeletonLines, ToastProvider, useToast } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { getProvider, ERC20_ABI, rpcErrorReason } from "./provider";
import { fetchUsdPrices, totalUsd, coinIdForSymbol, stableUsdPrice } from "./usdValue";
import {
  hasWallet,
  getStoredAddress,
  clearWallet,
  getLegacyWallet,
  claimLegacyWallet,
  discardLegacyWallet,
  isBackedUp,
} from "./keystore";
import {
  fetchChains,
  fetchTxs,
  clearAddress,
  updateTxStatus,
  saveAddress,
  saveCustomToken,
  fetchDiscoveredTokens,
  actOnDiscoveredToken,
} from "./walletApi";
import NewTokensCard from "./NewTokensCard";
import NetworkSwitcher, { recallChain } from "./NetworkSwitcher";
import Identicon from "./Identicon";
import TokenLogo from "../../components/TokenLogo";
import { prefetchLogos } from "./tokenLogos";
import BitcoinPanel from "./BitcoinPanel";
import { clearBitcoinAddressCache } from "./bitcoin/addressCache";
import HoldingDetail from "./HoldingDetail";
import CreateWalletModal from "./CreateWalletModal";
import ImportWalletModal from "./ImportWalletModal";
import AddTokenModal from "./AddTokenModal";
import SendForm from "./SendForm";
import ReceivePanel from "./ReceivePanel";
import CollectedPanel from "./CollectedPanel";
import TxHistory from "./TxHistory";

/**
 * THE WALLET
 *
 * Modelled on the MetaMask browser view, and deliberately unlike every other
 * screen in this application.
 *
 * That is the point. The rest of the product is a book of account: ruled sheets,
 * figures in the margin, a masthead. A wallet is not a page of accounts. Somebody
 * who is about to move real value should be looking at the arrangement every
 * wallet they have ever used has taught them to read, because familiarity is a
 * safety property here and novelty is not. Network on the left, account across
 * the top, one large fiat figure, a row of round actions, then tokens and
 * activity.
 *
 * Everything the previous version guaranteed is preserved and marked below. The
 * important one: a balance that could not be READ is never rendered as a zero.
 */

function shorten(a) {
  return a ? `${a.slice(0, 6)}...${a.slice(-4)}` : "";
}

function usd(n) {
  return Number(n).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

/**
 * Bitcoin is offered in the SAME network menu as the EVM chains, because from
 * the owner's point of view it is simply another network their one recovery
 * phrase reaches. It is not an EVM chain and has no chainId, so it carries a
 * string id and a `kind` the rest of the wallet branches on. Everything about
 * Bitcoin lives in BitcoinPanel; nothing EVM specific is asked to pretend.
 */
const BITCOIN_CHAINS = [
  {
    chainId: "bitcoin",
    kind: "bitcoin",
    key: "bitcoin",
    name: "Bitcoin",
    nativeSymbol: "BTC",
    testnet: false,
    tokens: [],
  },
  {
    chainId: "bitcoin-testnet",
    kind: "bitcoin",
    key: "bitcoin-testnet",
    name: "Bitcoin Testnet",
    nativeSymbol: "tBTC",
    testnet: true,
    tokens: [],
    faucet: "https://coinfaucet.eu/en/btc-testnet/",
  },
];

function WalletInner() {
  const { user, applyUser } = useAuth();
  const [chains, setChains] = useState([]);
  const [chainId, setChainId] = useState(null);
  // The server's mainnet switch. Bitcoin mainnet is offered only when it is on,
  // so the one flag gates every real money network, EVM and Bitcoin alike.
  const [enableMainnet, setEnableMainnet] = useState(false);
  const [address, setAddress] = useState(getStoredAddress());
  const [legacy, setLegacy] = useState(() => getLegacyWallet());
  const [claiming, setClaiming] = useState(false);
  const [hideZero, setHideZero] = useState(false);
  // Re-read rather than captured once: revealing the phrase in Settings flips
  // this, and coming back to the wallet should not still be nagging.
  const [backedUp, setBackedUp] = useState(() => isBackedUp());
  const [backupDismissed, setBackupDismissed] = useState(false);
  const [addTokenOpen, setAddTokenOpen] = useState(false);
  // The balance row that was clicked, or null. Opens the coin detail for it.
  const [detail, setDetail] = useState(null);
  const [tab, setTab] = useState("tokens");
  // Which panel is open in the drawer beneath the wallet, or null for none. The
  // frame above stays a wallet and never turns into a form.
  const [panel, setPanel] = useState(null);
  const [balances, setBalances] = useState(null);
  const [balLoading, setBalLoading] = useState(false);
  // USD prices keyed by wallet SYMBOL. A symbol that never arrives stays
  // UNPRICED rather than counting as zero: a total that quietly omits a holding
  // is a wrong number wearing the clothes of a right one.
  const [usdPrices, setUsdPrices] = useState({});
  const [pricesFailed, setPricesFailed] = useState(false);
  // Why the last balance read failed, when it did. Shown instead of a bare "try
  // refresh", which gives the user nothing to act on.
  const [balError, setBalError] = useState(null);
  const [txs, setTxs] = useState([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const toast = useToast();
  // Tokens that arrived which this wallet was never told about, on the
  // current chain. Null until the first check, and the card renders nothing
  // for null, so a chain switch never shows the previous chain's list.
  const [discovered, setDiscovered] = useState(null);
  const [discoverySyncFailed, setDiscoverySyncFailed] = useState(false);
  const [discoveredBusy, setDiscoveredBusy] = useState(null);
  const [discoveredError, setDiscoveredError] = useState("");

  // The menu shows the EVM chains the server allows plus Bitcoin. `chains` stays
  // the EVM-only list everywhere else in this file, so no EVM code path can ever
  // be handed a Bitcoin entry by accident.
  const selectableChains = useMemo(
    () => [...chains, ...BITCOIN_CHAINS.filter((c) => c.testnet || enableMainnet)],
    [chains, enableMainnet]
  );
  const selected = selectableChains.find((c) => c.chainId === chainId) || null;
  const isBitcoin = Boolean(selected && selected.kind === "bitcoin");
  const chain = isBitcoin ? null : selected;

  /**
   * Net worth on THIS network, plus what could not be counted. The caveat is
   * returned alongside the number rather than folded into it.
   */
  const worth = useMemo(() => totalUsd(balances || [], usdPrices), [balances, usdPrices]);

  // The native row is never hidden: it pays for everything, so a zero there is
  // the single most important number on this screen. Unknown rows are never
  // hidden either, since that is the figure the user most needs to see.
  const visibleBalances = (balances || []).filter(
    (b) => !hideZero || b.native || b.unknown || Number(b.amount) > 0
  );

  const hiddenCount = (balances || []).length - visibleBalances.length;

  // Keystores are scoped per account, so switching account changes which wallet
  // (if any) belongs to this page. Re-read on identity change rather than
  // trusting the value captured at mount.
  useEffect(() => {
    setAddress(getStoredAddress());
    setLegacy(getLegacyWallet());
    setBalances(null);
    setTxs([]);
    setDiscovered(null);
  }, [user?._id]);

  // Load the config driven chain list once. The server already filters disabled
  // chains; we filter again here so a mainnet entry can never surface client
  // side unless ENABLE_MAINNET is explicitly on. Defence in depth.
  useEffect(() => {
    fetchChains()
      .then((d) => {
        const usable = (d.chains || []).filter((c) => c.testnet || d.enableMainnet);
        setChains(usable);
        setEnableMainnet(Boolean(d.enableMainnet));
        // Restore the chain chosen earlier this session rather than snapping
        // back to the first in the list on every reload.
        if (usable.length) setChainId((prev) => prev || recallChain(usable));
      })
      .catch(() => setChains([]));
  }, []);

  // Curated (verified on chain) tokens for this chain, plus anything the user
  // added themselves. Custom entries carry the decimals read from their contract.
  const chainTokens = useMemo(() => {
    if (!chain) return [];
    const custom = (user?.customTokens || [])
      .filter((t) => t.chainId === chain.chainId)
      .map((t) => ({ ...t, custom: true }));
    return [...(chain.tokens || []), ...custom];
  }, [chain, user?.customTokens]);

  const loadBalances = useCallback(async () => {
    if (!address || !chain) return;
    setBalLoading(true);
    try {
      const provider = getProvider(chain.chainId);
      const native = await provider.getBalance(address);
      const rows = [
        { symbol: chain.nativeSymbol, amount: ethers.formatEther(native), native: true },
      ];
      for (const t of chainTokens) {
        try {
          const c = new ethers.Contract(t.address, ERC20_ABI, provider);
          const bal = await c.balanceOf(address);
          rows.push({
            symbol: t.symbol,
            amount: ethers.formatUnits(bal, t.decimals),
            native: false,
            custom: Boolean(t.custom),
            address: t.address,
          });
        } catch (tokenErr) {
          /**
           * UNKNOWN, not zero. This previously pushed "0", which renders exactly
           * like a genuine empty balance, so an RPC failure looked identical to
           * having spent everything. Someone could reasonably conclude their
           * funds were gone. An unread balance says so.
           *
           * The reason is carried on the ROW: a token only failure never reaches
           * the outer catch, so without this the row said "could not be read"
           * and gave no clue why.
           */
          rows.push({
            symbol: t.symbol,
            amount: null,
            unknown: true,
            reason: rpcErrorReason(tokenErr),
            native: false,
            custom: Boolean(t.custom),
            address: t.address,
          });
        }
      }
      setBalances(rows);
      setBalError(null);

      // ONE logo request for the whole wallet. Eight rows each asking for their
      // own would be eight round trips for something purely cosmetic, and the
      // balances must never wait on it.
      prefetchLogos(rows.map((r) => r.symbol));

      /**
       * Price them. Deliberately AFTER the balances are set, so the amounts
       * appear immediately and the USD column fills in a moment later. Making
       * the whole panel wait on CoinGecko would let a price outage hide balances
       * that were read perfectly well.
       */
      /**
       * KEEP ASKING UNTIL THE PRICES ACTUALLY ARRIVE.
       *
       * This was a single attempt. When the server's price cache was still cold
       * it answered with an empty map, which is a RESOLVED promise, so the code
       * recorded it as a success, wrote `{}` into state and never asked again —
       * every row read "No price" until the page was reloaded by hand. That is
       * why the wallet needed constant refreshing.
       *
       * Prices are keyed by SYMBOL and a dollar price is the same on every
       * chain, so a late answer arriving after the user has switched network is
       * harmless: it can only fill a gap, never contradict the current chain.
       * That is why this needs no cancellation guard, and it is worth saying out
       * loud because the same pattern WOULD be unsafe for balances.
       */
      (async () => {
        const symbols = rows.map((r) => r.symbol);
        // What we can legitimately expect a number for. A custom token nobody
        // has a mapping for is not a failure and must not drive a retry.
        const priceable = symbols.filter(
          (s) => stableUsdPrice(s) != null || coinIdForSymbol(s)
        );

        let merged = {};
        for (let attempt = 0; attempt <= 3; attempt++) {
          let got = {};
          try {
            got = await fetchUsdPrices(symbols);
          } catch {
            /* keep whatever earlier attempts produced */
          }
          merged = { ...merged, ...got };
          setUsdPrices(merged);

          const missing = priceable.filter(
            (s) => !Number.isFinite(merged[String(s).toUpperCase()])
          );
          setPricesFailed(missing.length > 0);
          if (missing.length === 0) return;

          // Widening backoff: the usual cause is a cold cache upstream that
          // fills within a few seconds, and hammering it would only slow that.
          await new Promise((r) => setTimeout(r, 3000 * Math.pow(2, attempt)));
        }
      })();
    } catch (err) {
      setBalances(null);
      setBalError(rpcErrorReason(err));
    } finally {
      setBalLoading(false);
    }
  }, [address, chain, chainTokens]);

  const loadTxs = useCallback(async () => {
    if (!address || !chain) return;
    let rows;
    try {
      rows = await fetchTxs(chain.chainId);
      setTxs(rows);
    } catch {
      setTxs([]);
      return;
    }

    // Reconcile stragglers: a send whose confirmation landed after a reload is
    // still recorded as pending. Ask the chain for a receipt and settle it. Uses
    // the allowlisted eth_getTransactionReceipt via the proxy; failures are
    // ignored because the row still deep links to the explorer.
    const pending = rows.filter((t) => t.status === "pending");
    if (pending.length === 0) return;
    try {
      const provider = getProvider(chain.chainId);
      const settled = await Promise.all(
        pending.map(async (t) => {
          try {
            const receipt = await provider.getTransactionReceipt(t.hash);
            if (!receipt) return null; // still genuinely in the mempool
            const status = receipt.status === 1 ? "confirmed" : "failed";
            await updateTxStatus(t._id, status);
            return { _id: t._id, status };
          } catch {
            return null;
          }
        })
      );
      const changes = settled.filter(Boolean);
      if (changes.length) {
        setTxs((prev) =>
          prev.map((t) => {
            const hit = changes.find((c) => c._id === t._id);
            return hit ? { ...t, status: hit.status } : t;
          })
        );
      }
    } catch {
      /* leave them pending; the row still deep links to the explorer */
    }
  }, [address, chain]);

  /**
   * Ask the server whether anything arrived that this wallet does not know
   * about. The server scans the chain as part of answering, so opening the
   * wallet is what notices an arrival. A failed check keeps the previous
   * list and says so; it is not a balance and not a payment, so it never
   * blocks either.
   */
  const loadDiscovered = useCallback(async () => {
    if (!address || !chain) return;
    setDiscovered(null);
    setDiscoveredError("");
    try {
      const { tokens, sync } = await fetchDiscoveredTokens(chain.chainId);
      setDiscovered(tokens);
      setDiscoverySyncFailed(Boolean(sync && sync.failed));
    } catch {
      setDiscovered([]);
      setDiscoverySyncFailed(true);
    }
  }, [address, chain]);

  useEffect(() => {
    loadBalances();
    loadTxs();
    loadDiscovered();
    // Backup state can change on another screen (Settings, wallet backup), so it
    // is re-read whenever this page becomes active rather than trusted from the
    // first render.
    setBackedUp(isBackedUp());
  }, [loadBalances, loadTxs, loadDiscovered]);

  /**
   * The owner's decision on a token that arrived uninvited. Adding uses the
   * decimals the server read from the contract and refreshes the balances,
   * which is where the token then appears with an "added" label like any
   * other imported token.
   */
  async function decideDiscovered(t, action) {
    if (!chain) return;
    setDiscoveredBusy(t.address);
    setDiscoveredError("");
    try {
      const { tokens, customTokens } = await actOnDiscoveredToken({
        chainId: chain.chainId,
        address: t.address,
        action,
      });
      setDiscovered(tokens);
      if (action === "add") {
        // Updating the account's token list changes `chainTokens`, which
        // re-runs the balance load with the new token included.
        if (applyUser && user) applyUser({ ...user, customTokens });
        setBalances(null);
        toast(`${t.symbol} is now shown in your wallet on ${chain.name}.`, { type: "success" });
      } else if (action === "ignore") {
        toast(`${t.symbol || "That token"} will stay off your lists.`, { type: "info" });
      }
    } catch (err) {
      setDiscoveredError(
        err?.response?.data?.error || "Could not update that token just now. Try again."
      );
    } finally {
      setDiscoveredBusy(null);
    }
  }

  function onWalletReady(addr) {
    // A new or imported keystore is a different wallet. Any Bitcoin address
    // remembered for the old one must not be shown for this one: it would be an
    // address this device can no longer sign for. The cache is also keyed on
    // the keystore address, so this is belt and braces rather than the only
    // guard.
    clearBitcoinAddressCache(user?._id);
    setAddress(addr);
    setLegacy(null);
    setCreateOpen(false);
    setImportOpen(false);
  }

  // Take over the pre scoping wallet for THIS account. Explicit and one time:
  // the legacy entry is removed on success so a second account cannot claim the
  // same wallet, which is the cross account leak this whole change fixes.
  async function claimLegacy() {
    setClaiming(true);
    try {
      const addr = claimLegacyWallet();
      const saved = await saveAddress(addr).catch(() => null);
      if (saved && applyUser && user) applyUser({ ...user, walletAddress: addr });
      setLegacy(null);
      setAddress(addr);
    } catch {
      /* the panel stays up; the user can create a wallet instead */
    } finally {
      setClaiming(false);
    }
  }

  // Persisted against the account rather than this browser, so the token list
  // follows the user to another device the way their wallet address does.
  async function addCustomToken(token) {
    try {
      await saveCustomToken(token);
      if (applyUser && user) {
        applyUser({ ...user, customTokens: [...(user.customTokens || []), token] });
      }
      setAddTokenOpen(false);
      setBalances(null);
      loadBalances();
    } catch (err) {
      // The modal stays open so the user can retry or cancel, and the failure
      // is SAID (LW-028): it used to go to the console only, so the button
      // appeared to do nothing and got clicked again.
      const reason = err?.response?.data?.error || err.message || "Could not add that token.";
      toast(reason, { type: "error" });
    }
  }

  function discardLegacy() {
    if (
      !window.confirm(
        "Forget that earlier wallet? If you have not saved its recovery phrase, anything in it becomes unreachable."
      )
    ) {
      return;
    }
    discardLegacyWallet();
    setLegacy(null);
  }

  async function removeWallet() {
    if (
      !window.confirm(
        "Remove this wallet from this device? Make sure your recovery phrase is backed up, because this cannot be undone here."
      )
    ) {
      return;
    }
    clearWallet();
    clearBitcoinAddressCache(user?._id);
    await clearAddress().catch(() => {});
    // Keep context in step, or the "has a wallet but not on this device" card
    // would appear immediately after deliberately removing it.
    if (applyUser && user) applyUser({ ...user, walletAddress: null });
    setAddress(null);
    setBalances(null);
    setTxs([]);
    setDiscovered(null);
  }

  async function copyAddr() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* the address is on screen to copy by hand */
    }
  }

  function openPanel(next) {
    setPanel((p) => (p === next ? null : next));
  }

  // ---------------------------------------------------------------- setup ----
  if (!hasWallet() || !address) {
    return (
      <>
        {/* This account already registered an address, but its keystore is not
            in this browser: a different machine, or storage was cleared. Say so,
            rather than implying the account has no wallet. */}
        {user?.walletAddress && (
          <div className="mm-stage">
            <Card className="mm-setup">
              <span className="mm-setup-mark">
                <History size={22} />
              </span>
              <h3>Your wallet is not on this device</h3>
              <p>
                This account is registered to{" "}
                <code className="num">{shorten(user.walletAddress)}</code>. Keys only ever live in
                the browser they were made in, so bring it back with its recovery phrase.
              </p>
              <div className="row" style={{ justifyContent: "center", marginTop: 18 }}>
                <Button variant="primary" onClick={() => setImportOpen(true)}>
                  <DownloadCloud size={15} /> Import with recovery phrase
                </Button>
              </div>
            </Card>
          </div>
        )}

        {/* A wallet left over from before keystores were scoped per account.
            Only ever adopted on an explicit click. */}
        {legacy && (
          <div className="mm-stage">
            <Card className="mm-setup">
              <span className="mm-setup-mark">
                <WalletIcon size={22} />
              </span>
              <h3>There is an earlier wallet in this browser</h3>
              <p>
                <code className="num">{shorten(legacy.address)}</code> was created before wallets
                were kept separate per account, so it belongs to nobody yet. Claim it for{" "}
                <strong>{user?.email}</strong> and it becomes this account's wallet, using the
                password you originally set.
              </p>
              <div className="row" style={{ justifyContent: "center", marginTop: 18 }}>
                <Button variant="primary" onClick={claimLegacy} disabled={claiming}>
                  <Check size={15} /> {claiming ? "Claiming..." : "Claim for this account"}
                </Button>
                <Button variant="ghost" onClick={discardLegacy} disabled={claiming}>
                  <Trash2 size={14} /> Forget it
                </Button>
              </div>
            </Card>
          </div>
        )}

        <div className="mm-stage">
          <Card className="mm-setup">
            <span className="mm-setup-mark">
              <WalletIcon size={24} />
            </span>
            <h3>Create or bring your wallet</h3>
            <p>
              Keys are generated and encrypted here in your browser. Only the encrypted keystore
              touches this device, and the plaintext key never reaches our servers. Every account
              gets its own wallet, so this one is separate from any other you sign into.
            </p>
            <div className="row" style={{ justifyContent: "center", marginTop: 20 }}>
              <Button variant="primary" onClick={() => setCreateOpen(true)}>
                <PlusCircle size={15} /> Create a wallet
              </Button>
              <Button variant="secondary" onClick={() => setImportOpen(true)}>
                <DownloadCloud size={15} /> Import one
              </Button>
            </div>
            <p className="muted small" style={{ marginTop: 18 }}>
              Real networks are available alongside the test ones, and the network name turns red on a
              real one. Nothing is signed without the password you set here.
            </p>
          </Card>
        </div>

        {createOpen && (
          <CreateWalletModal onClose={() => setCreateOpen(false)} onDone={onWalletReady} />
        )}
        {importOpen && (
          <ImportWalletModal onClose={() => setImportOpen(false)} onDone={onWalletReady} />
        )}
      </>
    );
  }

  // --------------------------------------------------------------- active ----

  return (
    <>
      <div className="mm-stage">
        <div className="mm">
          {/* ---- top bar: network, account, tools ---- */}
          <div className="mm-top">
            <NetworkSwitcher
              chains={selectableChains}
              chainId={chainId}
              address={address}
              onChange={setChainId}
            />

            {/* The EVM account pill and tools belong to an EVM chain. Bitcoin
                renders its own account row, with its own address, inside
                BitcoinPanel. */}
            {!isBitcoin && (
              <>
            <button type="button" className="mm-acct" onClick={copyAddr} title="Copy your address">
              <Identicon address={address} size={22} />
              <span className="addr num">{shorten(address)}</span>
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>

            <div className="mm-icons">
              <button
                type="button"
                className="mm-icon"
                onClick={loadBalances}
                title="Refresh balances"
                aria-label="Refresh balances"
              >
                <RefreshCw size={15} className={balLoading ? "spin" : undefined} />
              </button>
              <button
                type="button"
                className="mm-icon"
                onClick={removeWallet}
                title="Remove this wallet from this device"
                aria-label="Remove this wallet from this device"
              >
                <Trash2 size={15} />
              </button>
            </div>
              </>
            )}
          </div>

          {isBitcoin && (
            <BitcoinPanel
              userId={user?._id}
              network={selected.chainId === "bitcoin" ? "mainnet" : "testnet"}
              // The keystore's address is part of the Bitcoin address cache key.
              // Passing it as a prop means importing a different phrase while
              // this panel is open re-keys the cache immediately, rather than on
              // the next mount.
              evmAddress={address}
            />
          )}

          {!isBitcoin && (
            <>
          {/* The "this is a real network" notice that sat here is gone at the
              owner's request. The network pill in the switcher still styles a
              mainnet differently, and every send still takes a password typed
              for that transaction, which is the control that actually matters. */}

          {/* A wallet whose phrase was never written down is one cleared browser
              away from being unrecoverable. Not stolen, just gone, with the owner
              never having been handed the thing that would have saved it.
              Dismissible for the session, because nagging that cannot be
              silenced gets ignored, but it returns on the next visit until the
              phrase has actually been seen. */}
          {!backedUp && !backupDismissed && (
            <div className="mm-notice">
              <TriangleAlert size={16} />
              <span className="grow">
                <strong>Back this wallet up.</strong> You have not seen your recovery phrase yet.
                Without it, clearing this browser or losing this device means the funds are gone for
                good, for you and for us.{" "}
                <Link className="mm-linkish" to="/app/settings?section=wallet-backup">
                  Do it now
                </Link>
              </span>
              <button
                type="button"
                className="mm-icon"
                onClick={() => setBackupDismissed(true)}
                title="Dismiss"
                aria-label="Dismiss"
              >
                <X size={15} />
              </button>
            </div>
          )}

          {/* ---- the figure ---- */}
          <div className="mm-hero">
            {balances ? (
              <>
                <span className="mm-fiat">{usd(worth.total)}</span>
                <span className="mm-sub">
                  {chain ? `Held on ${chain.name}` : "Select a network"}
                </span>

                {/* Never present an incomplete total as a complete one. */}
                {!worth.complete && (
                  <span className="mm-caveat">
                    {worth.unread.length > 0 &&
                      `${worth.unread.join(", ")} could not be read just now, so ${
                        worth.unread.length === 1 ? "it is" : "they are"
                      } missing from this total. `}
                    {worth.unpriced.length > 0 &&
                      `There is no dollar price for ${worth.unpriced.join(", ")}, so ${
                        worth.unpriced.length === 1 ? "it is" : "they are"
                      } not counted here.`}
                  </span>
                )}
                {pricesFailed && (
                  <span className="mm-caveat">
                    Prices are unavailable right now, so this total is incomplete. The amounts below
                    are still correct.
                  </span>
                )}
              </>
            ) : balLoading ? (
              <span className="mm-fiat" style={{ opacity: 0.35 }}>
                {usd(0)}
              </span>
            ) : (
              <>
                <span className="mm-fiat" style={{ fontSize: 24 }}>
                  Balance unavailable
                </span>
                <span className="mm-caveat">
                  {balError
                    ? `The network did not answer: ${balError}. Your funds are untouched, this is a connection problem.`
                    : "The network did not answer. Your funds are untouched, this is a connection problem."}
                </span>
              </>
            )}
          </div>

          {/* ---- actions ---- */}
          <div className="mm-actions">
            <button type="button" className="mm-action brass" onClick={() => openPanel("receive")}>
              <span className="ring">
                <ArrowDownToLine size={19} />
              </span>
              Receive
            </button>
            <button
              type="button"
              className="mm-action"
              onClick={() => openPanel("send")}
              disabled={!chain}
            >
              <span className="ring">
                <ArrowUpRight size={19} />
              </span>
              Send
            </button>
            <button
              type="button"
              className="mm-action"
              onClick={() => openPanel("collected")}
              disabled={!chain}
            >
              <span className="ring">
                <Inbox size={19} />
              </span>
              Collected
            </button>
          </div>

          {/* Tokens that arrived uninvited. The wallet recommends; the owner
              decides. Renders nothing until the first check has answered. */}
          {chain && discovered && (
            <NewTokensCard
              chain={chain}
              tokens={discovered}
              syncFailed={discoverySyncFailed}
              busyAddress={discoveredBusy}
              error={discoveredError}
              onAdd={(t) => decideDiscovered(t, "add")}
              onIgnore={(t) => decideDiscovered(t, "ignore")}
              onRestore={(t) => decideDiscovered(t, "restore")}
            />
          )}

          {/* ---- tokens and activity ---- */}
          <div className="mm-tabs">
            <button
              type="button"
              className={tab === "tokens" ? "mm-tab active" : "mm-tab"}
              onClick={() => setTab("tokens")}
            >
              Tokens
            </button>
            <button
              type="button"
              className={tab === "activity" ? "mm-tab active" : "mm-tab"}
              onClick={() => setTab("activity")}
            >
              Activity
            </button>
          </div>

          {tab === "tokens" ? (
            <>
              <div className="mm-list">
                {balLoading && !balances ? (
                  <div style={{ padding: 16 }}>
                    <SkeletonLines count={3} />
                  </div>
                ) : balances ? (
                  visibleBalances.map((b) => {
                    const price = usdPrices[String(b.symbol).toUpperCase()];
                    const value =
                      !b.unknown && Number.isFinite(price) ? Number(b.amount) * price : null;
                    return (
                      <div
                        className="mm-row"
                        key={`${b.symbol}-${b.address || "native"}`}
                        role="button"
                        tabIndex={0}
                        title={`About ${b.symbol}`}
                        style={{ cursor: "pointer" }}
                        onClick={() => setDetail(b)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setDetail(b);
                          }
                        }}
                      >
                        <TokenLogo
                          symbol={b.symbol}
                          native={b.native}
                          unknown={b.unknown}
                        />
                        <span className="mm-row-main">
                          <span className="mm-row-name">
                            {b.symbol}
                            {b.custom && (
                              <span className="lw-label" style={{ letterSpacing: "0.12em" }}>
                                added
                              </span>
                            )}
                          </span>
                          {/* The native token pays for every transaction, so it
                              is labelled here rather than discovered at signing
                              time. An unreadable row says so in words and never
                              shows a number. */}
                          {b.unknown ? (
                            <span className="mm-row-note warn" title={b.reason || undefined}>
                              {b.reason ? `Could not be read: ${b.reason}` : "Could not be read"}
                            </span>
                          ) : b.native ? (
                            <span className="mm-row-note">Pays the network fees</span>
                          ) : null}
                        </span>
                        <span className="mm-row-right">
                          <span className="mm-row-fiat">
                            {b.unknown ? "Unknown" : value != null ? usd(value) : "No price"}
                          </span>
                          <span className="mm-row-qty">
                            {b.unknown
                              ? "amount unavailable"
                              : `${Number(b.amount).toLocaleString(undefined, {
                                  maximumFractionDigits: 6,
                                })} ${b.symbol}`}
                          </span>
                        </span>
                      </div>
                    );
                  })
                ) : (
                  <div className="mm-row">
                    <span className="mm-row-main">
                      <span className="mm-row-name">Nothing could be read</span>
                      <span className="mm-row-note warn">
                        {balError || "The network did not answer."}
                      </span>
                    </span>
                  </div>
                )}
              </div>

              <div className="mm-foot">
                <label className="toggle-inline">
                  <input
                    type="checkbox"
                    checked={hideZero}
                    onChange={(e) => setHideZero(e.target.checked)}
                  />
                  <span className="muted small">
                    Hide empty balances{hiddenCount > 0 ? ` (${hiddenCount} hidden)` : ""}
                  </span>
                </label>
                <button type="button" className="mm-linkish" onClick={() => setAddTokenOpen(true)}>
                  <PlusCircle size={14} /> Import a token
                </button>
              </div>
            </>
          ) : (
            <div className="mm-list" style={{ padding: 16 }}>
              <TxHistory
                txs={txs}
                chain={chain}
                chains={chains}
                onReceive={() => {
                  setTab("tokens");
                  setPanel("receive");
                }}
              />
            </div>
          )}
            </>
          )}
        </div>
      </div>

      {/* The drawer. Kept below the frame so the wallet stays a wallet. */}
      {!isBitcoin && panel && (
        <div className="mm-drawer">
          <Card
            title={
              panel === "send" ? "Send" : panel === "receive" ? "Receive" : "Collected on invoices"
            }
            action={
              <Button variant="ghost" icon title="Close" onClick={() => setPanel(null)}>
                <X size={15} />
              </Button>
            }
          >
            {panel === "send" && chain && (
              <SendForm
                // Remount on a network change. Without this the form's recipient,
                // amount, selected TOKEN ADDRESS and gas estimate survived a
                // switch and the send went out on the new chain with the old
                // chain's token contract. React reuses an instance in place
                // unless the key changes; the key changes.
                key={chain.chainId}
                address={address}
                chain={chain}
                onSent={() => {
                  setPanel(null);
                  setTab("activity");
                  loadTxs();
                  loadBalances();
                }}
                onConfirmed={() => {
                  // Receipt landed, so the row flips pending to confirmed and
                  // the balance reflects the settled transfer.
                  loadTxs();
                  loadBalances();
                }}
              />
            )}
            {panel === "receive" && chain && (
              <ReceivePanel key={chain.chainId} address={address} chain={chain} />
            )}
            {panel === "collected" && chain && (
              <CollectedPanel
                key={chain.chainId} // a sweep must never carry one chain's plan onto another
                chain={chain}
                mainAddress={address}
                sweepDestination={user?.crypto?.sweepDestination}
                onSwept={() => {
                  // Swept funds land in this wallet, so both views are stale.
                  loadBalances();
                  loadTxs();
                }}
              />
            )}
          </Card>
        </div>
      )}

      {/* The "EVM only" note that stood here was false: Bitcoin lives in this
          same wallet, one entry up in the network menu. */}

      {detail && (
        <HoldingDetail
          balance={detail}
          chain={chain}
          price={usdPrices[String(detail.symbol).toUpperCase()]}
          onClose={() => setDetail(null)}
        />
      )}

      {addTokenOpen && chain && (
        <AddTokenModal
          chain={chain}
          address={address}
          existing={chainTokens}
          onClose={() => setAddTokenOpen(false)}
          onAdd={addCustomToken}
        />
      )}
    </>
  );
}

// Own ToastProvider so wallet toasts work independently of the other tabs.
export default function WalletPage() {
  return (
    <ToastProvider>
      <WalletInner />
    </ToastProvider>
  );
}
