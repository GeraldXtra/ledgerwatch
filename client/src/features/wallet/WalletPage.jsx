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
import { Button, Card, SkeletonLines, ToastProvider, useToast, PageHeader } from "../../components/ui";
import { DetailPane } from "../../components/ui/Modal";
import { useAuth } from "../../context/AuthContext";
import { getProvider, ERC20_ABI, rpcErrorReason } from "./provider";
import { fetchUsdPrices, totalUsd, coinIdForSymbol, stableUsdPrice, isVerifiedRow } from "./usdValue";
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
  removeCustomToken,
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
import UtxoPanel from "./UtxoPanel";
import TronPanel from "./TronPanel";
import SolanaPanel from "./SolanaPanel";
import TonPanel from "./TonPanel";
import RampCard from "./RampCard";
import { clearChainAddresses } from "./chainAddresses";
import { clearPendingSends } from "./bitcoin/pendingSend";
import HoldingDetail from "./HoldingDetail";
import CreateWalletModal from "./CreateWalletModal";
import ImportWalletModal from "./ImportWalletModal";
import AddTokenModal from "./AddTokenModal";
import SendForm from "./SendForm";
import ReceivePanel from "./ReceivePanel";
import CollectedPanel from "./CollectedPanel";
import TxHistory from "./TxHistory";

function shorten(a) {
  return a ? `${a.slice(0, 6)}...${a.slice(-4)}` : "";
}

function stillCurrent(run) {
  return !run || run.live !== false;
}

function usd(n) {
  return Number(n).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

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

const UTXO_CHAINS = [
  {
    chainId: "litecoin",
    kind: "utxo",
    coin: "litecoin",
    network: "mainnet",
    key: "litecoin",
    name: "Litecoin",
    nativeSymbol: "LTC",
    testnet: false,
    tokens: [],
  },
  {
    chainId: "litecoin-testnet",
    kind: "utxo",
    coin: "litecoin",
    network: "testnet",
    key: "litecoin-testnet",
    name: "Litecoin Testnet",
    nativeSymbol: "tLTC",
    testnet: true,
    tokens: [],
  },
  {
    chainId: "dogecoin",
    kind: "utxo",
    coin: "dogecoin",
    network: "mainnet",
    key: "dogecoin",
    name: "Dogecoin",
    nativeSymbol: "DOGE",
    testnet: false,
    tokens: [],
  },
];

const TRON_CHAINS = [
  { chainId: "tron", kind: "tron", network: "mainnet", key: "tron", name: "TRON", nativeSymbol: "TRX", testnet: false, tokens: [] },
  {
    chainId: "tron-testnet",
    kind: "tron",
    network: "testnet",
    key: "tron-testnet",
    name: "TRON Nile Testnet",
    nativeSymbol: "TRX",
    testnet: true,
    tokens: [],
    faucet: "https://nileex.io/join/getJoinPage",
  },
];

const SOLANA_CHAINS = [
  { chainId: "solana", kind: "solana", network: "mainnet", key: "solana", name: "Solana", nativeSymbol: "SOL", testnet: false, tokens: [] },
  {
    chainId: "solana-devnet",
    kind: "solana",
    network: "devnet",
    key: "solana-devnet",
    name: "Solana Devnet",
    nativeSymbol: "SOL",
    testnet: true,
    tokens: [],
    faucet: "https://faucet.solana.com",
  },
];

const TON_CHAINS = [
  { chainId: "ton", kind: "ton", network: "mainnet", key: "ton", name: "TON", nativeSymbol: "TON", testnet: false, tokens: [] },
  { chainId: "ton-testnet", kind: "ton", network: "testnet", key: "ton-testnet", name: "TON Testnet", nativeSymbol: "TON", testnet: true, tokens: [] },
];

const NON_EVM_CHAINS = [...BITCOIN_CHAINS, ...UTXO_CHAINS, ...TRON_CHAINS, ...SOLANA_CHAINS, ...TON_CHAINS];
const NON_EVM_KINDS = new Set(["bitcoin", "utxo", "tron", "solana", "ton"]);

function WalletInner() {
  const { user, applyUser } = useAuth();
  const [chains, setChains] = useState([]);
  const [chainId, setChainId] = useState(null);
  const [enableMainnet, setEnableMainnet] = useState(false);
  const [address, setAddress] = useState(getStoredAddress());
  const [legacy, setLegacy] = useState(() => getLegacyWallet());
  const [claiming, setClaiming] = useState(false);
  const [hideZero, setHideZero] = useState(false);
  const [backedUp, setBackedUp] = useState(() => isBackedUp());
  const [backupDismissed, setBackupDismissed] = useState(false);
  const [addTokenOpen, setAddTokenOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const [tab, setTab] = useState("tokens");
  const [panel, setPanel] = useState(null);
  const [balances, setBalances] = useState(null);
  const [balLoading, setBalLoading] = useState(false);
  const [usdPrices, setUsdPrices] = useState({});
  const [pricesFailed, setPricesFailed] = useState(false);
  const [balError, setBalError] = useState(null);
  const [txs, setTxs] = useState([]);
  const [txsError, setTxsError] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const toast = useToast();
  const [discovered, setDiscovered] = useState(null);
  const [discoverySyncFailed, setDiscoverySyncFailed] = useState(false);
  const [discoveredBusy, setDiscoveredBusy] = useState(null);
  const [discoveredError, setDiscoveredError] = useState("");

  const selectableChains = useMemo(
    () => [...chains, ...NON_EVM_CHAINS.filter((c) => c.testnet || enableMainnet)],
    [chains, enableMainnet]
  );
  const selected = selectableChains.find((c) => c.chainId === chainId) || null;
  const isBitcoin = Boolean(selected && selected.kind === "bitcoin");
  const isNonEvm = Boolean(selected && NON_EVM_KINDS.has(selected.kind));
  const chain = isNonEvm ? null : selected;

  const worth = useMemo(() => totalUsd(balances || [], usdPrices), [balances, usdPrices]);

  const visibleBalances = (balances || []).filter(
    (b) => !hideZero || b.native || b.unknown || Number(b.amount) > 0
  );

  const hiddenCount = (balances || []).length - visibleBalances.length;

  useEffect(() => {
    setAddress(getStoredAddress());
    setLegacy(getLegacyWallet());
    setBalances(null);
    setTxs([]);
    setTxsError(null);
    setDiscovered(null);
  }, [user?._id]);

  useEffect(() => {
    fetchChains()
      .then((d) => {
        const usable = (d.chains || []).filter((c) => c.testnet || d.enableMainnet);
        setChains(usable);
        setEnableMainnet(Boolean(d.enableMainnet));
        const selectable = [
          ...usable,
          ...NON_EVM_CHAINS.filter((c) => c.testnet || d.enableMainnet),
        ];
        if (selectable.length) setChainId((prev) => prev || recallChain(selectable, d.defaultChainId));
      })
      .catch(() => setChains([]));
  }, []);

  const chainTokens = useMemo(() => {
    if (!chain) return [];
    const custom = (user?.customTokens || [])
      .filter((t) => t.chainId === chain.chainId)
      .map((t) => ({ ...t, custom: true }));
    return [...(chain.tokens || []), ...custom];
  }, [chain, user?.customTokens]);

  const loadBalances = useCallback(async (run) => {
    if (!address || !chain) return;
    setBalLoading(true);
    try {
      const provider = getProvider(chain.chainId);
      const native = await provider.getBalance(address);
      const rows = [
        {
          symbol: chain.nativeSymbol,
          amount: ethers.formatEther(native),
          native: true,
          verified: true,
        },
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
            verified: !t.custom,
            address: t.address,
          });
        } catch (tokenErr) {
          rows.push({
            symbol: t.symbol,
            amount: null,
            unknown: true,
            reason: rpcErrorReason(tokenErr),
            native: false,
            custom: Boolean(t.custom),
            verified: !t.custom,
            address: t.address,
          });
        }
      }
      if (!stillCurrent(run)) return;
      setBalances(rows);
      setBalError(null);

      prefetchLogos(rows.filter(isVerifiedRow).map((r) => r.symbol));

      (async () => {
        const symbols = rows.filter(isVerifiedRow).map((r) => r.symbol);
        const priceable = symbols.filter(
          (s) => stableUsdPrice(s) != null || coinIdForSymbol(s)
        );

        let merged = {};
        for (let attempt = 0; attempt <= 3; attempt++) {
          let got = {};
          try {
            got = await fetchUsdPrices(symbols);
          } catch {
          }
          merged = { ...merged, ...got };
          setUsdPrices(merged);

          const missing = priceable.filter(
            (s) => !Number.isFinite(merged[String(s).toUpperCase()])
          );
          setPricesFailed(missing.length > 0);
          if (missing.length === 0) return;

          await new Promise((r) => setTimeout(r, 3000 * Math.pow(2, attempt)));
        }
      })();
    } catch (err) {
      if (!stillCurrent(run)) return;
      setBalances(null);
      setBalError(rpcErrorReason(err));
    } finally {
      if (stillCurrent(run)) setBalLoading(false);
    }
  }, [address, chain, chainTokens]);

  const loadTxs = useCallback(async (run) => {
    if (!address || !chain) return;
    let rows;
    try {
      rows = await fetchTxs(chain.chainId);
      if (!stillCurrent(run)) return;
      setTxs(rows);
      setTxsError(null);
    } catch (err) {
      if (!stillCurrent(run)) return;
      setTxs([]);
      setTxsError(rpcErrorReason(err) || "Could not load your transaction history.");
      return;
    }

    const pending = rows.filter((t) => t.status === "pending");
    if (pending.length === 0) return;
    try {
      const provider = getProvider(chain.chainId);
      const settled = await Promise.all(
        pending.map(async (t) => {
          try {
            const receipt = await provider.getTransactionReceipt(t.hash);
            if (!receipt) return null;
            const status = receipt.status === 1 ? "confirmed" : "failed";
            await updateTxStatus(t._id, status);
            return { _id: t._id, status };
          } catch {
            return null;
          }
        })
      );
      const changes = settled.filter(Boolean);
      if (changes.length && stillCurrent(run)) {
        setTxs((prev) =>
          prev.map((t) => {
            const hit = changes.find((c) => c._id === t._id);
            return hit ? { ...t, status: hit.status } : t;
          })
        );
      }
    } catch {
    }
  }, [address, chain]);

  const loadDiscovered = useCallback(async (run) => {
    if (!address || !chain) return;
    setDiscovered(null);
    setDiscoveredError("");
    try {
      const { tokens, sync } = await fetchDiscoveredTokens(chain.chainId);
      if (!stillCurrent(run)) return;
      setDiscovered(tokens);
      setDiscoverySyncFailed(Boolean(sync && sync.failed));
    } catch {
      if (!stillCurrent(run)) return;
      setDiscovered([]);
      setDiscoverySyncFailed(true);
    }
  }, [address, chain]);

  useEffect(() => {
    const run = { live: true };
    loadBalances(run);
    loadTxs(run);
    loadDiscovered(run);
    setBackedUp(isBackedUp());
    return () => {
      run.live = false;
    };
  }, [loadBalances, loadTxs, loadDiscovered]);

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
    clearBitcoinAddressCache(user?._id);
    clearChainAddresses(user?._id);
    clearPendingSends(user?._id);
    setAddress(addr);
    setLegacy(null);
    setCreateOpen(false);
    setImportOpen(false);
  }

  async function claimLegacy() {
    setClaiming(true);
    try {
      const addr = claimLegacyWallet();
      const saved = await saveAddress(addr).catch((err) => {
        toast(
          `Your wallet was claimed, but this account's address could not be registered: ${
            err?.response?.data?.error || err.message || "the server did not answer"
          }`,
          { type: "error" }
        );
        return null;
      });
      if (saved && applyUser && user) applyUser({ ...user, walletAddress: addr });
      setLegacy(null);
      setAddress(addr);
    } catch (err) {
      toast(err?.message || "That wallet could not be claimed.", { type: "error" });
    } finally {
      setClaiming(false);
    }
  }

  async function addCustomToken(token) {
    try {
      const tokens = await saveCustomToken(token);
      if (applyUser && user) {
        applyUser({
          ...user,
          customTokens: Array.isArray(tokens)
            ? tokens
            : [...(user.customTokens || []), token],
        });
      }
      setAddTokenOpen(false);
      setBalances(null);
      loadBalances();
    } catch (err) {
      const reason = err?.response?.data?.error || err.message || "Could not add that token.";
      toast(reason, { type: "error" });
    }
  }

  async function removeToken(token) {
    if (!chain || !token || !token.address) return;
    if (
      !window.confirm(
        `Remove ${token.symbol || "this token"} from your wallet on ${chain.name}? ` +
          "Nothing is moved or lost: the balance stays at your address on the chain and you can add the contract again."
      )
    ) {
      return;
    }
    try {
      const tokens = await removeCustomToken({
        chainId: chain.chainId,
        address: token.address,
      });
      if (applyUser && user) {
        applyUser({
          ...user,
          customTokens: Array.isArray(tokens)
            ? tokens
            : (user.customTokens || []).filter(
                (t) =>
                  !(
                    t.chainId === chain.chainId &&
                    String(t.address).toLowerCase() === String(token.address).toLowerCase()
                  )
              ),
        });
      }
      setDetail(null);
      setBalances(null);
      loadBalances();
      toast(`${token.symbol || "That token"} is no longer shown on ${chain.name}.`, {
        type: "success",
      });
    } catch (err) {
      toast(
        err?.response?.data?.error || err.message || "Could not remove that token just now.",
        { type: "error" }
      );
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
    clearChainAddresses(user?._id);
    clearPendingSends(user?._id);
    await clearAddress().catch((err) => {
      toast(
        `The wallet was removed from this device, but the server still has its address on file: ${
          err?.response?.data?.error || err.message || "the request failed"
        }`,
        { type: "error" }
      );
    });
    if (applyUser && user) applyUser({ ...user, walletAddress: null });
    setAddress(null);
    setBalances(null);
    setTxs([]);
    setTxsError(null);
    setDiscovered(null);
  }

  async function copyAddr() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast(
        "Your browser blocked the clipboard. Copy the address from the screen by hand.",
        { type: "error" }
      );
    }
  }

  function openPanel(next) {
    setPanel((p) => (p === next ? null : next));
  }

  if (!hasWallet() || !address) {
    return (
      <>
        <PageHeader title="Wallet" />
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

  const panelTitle =
    panel === "send" ? "Send" : panel === "receive" ? "Receive" : "Collected on invoices";

  return (
    <>
      <PageHeader
        title="Wallet"
        action={
          !isNonEvm ? (
            <>
              <button
                type="button"
                className="btn btn-icon"
                onClick={removeWallet}
                title="Remove this wallet from this device"
                aria-label="Remove this wallet from this device"
              >
                <Trash2 size={15} />
              </button>
              <button
                type="button"
                className="btn btn-icon"
                onClick={() => loadBalances()}
                title="Refresh balances"
                aria-label="Refresh balances"
              >
                <RefreshCw size={15} className={balLoading ? "spin" : undefined} />
              </button>
              <Button onClick={() => openPanel("collected")} disabled={!chain}>
                <Inbox size={16} /> Collected
              </Button>
              <Button onClick={() => openPanel("send")} disabled={!chain}>
                <ArrowUpRight size={16} /> Send
              </Button>
              <Button variant="primary" onClick={() => openPanel("receive")}>
                <ArrowDownToLine size={16} /> Receive
              </Button>
            </>
          ) : null
        }
      />

      {!isNonEvm && !backedUp && !backupDismissed && (
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
            className="btn btn-icon btn-sm"
            onClick={() => setBackupDismissed(true)}
            title="Dismiss"
            aria-label="Dismiss"
          >
            <X size={15} />
          </button>
        </div>
      )}

      <section className="card mm">
        <div className="card-head">
          <div className="card-head-main">
            <h3 className="card-title">Details</h3>
          </div>
        </div>
        <div className="mm-details">
          <div className="detail-stat">
            <span className="overline">Network</span>
            <span>
              <NetworkSwitcher
                chains={selectableChains}
                chainId={chainId}
                address={address}
                onChange={setChainId}
              />
            </span>
          </div>
          {!isNonEvm && (
            <div className="detail-stat">
              <span className="overline">Address</span>
              <span>
                <button type="button" className="mm-acct" onClick={copyAddr} title="Copy your address">
                  <Identicon address={address} size={22} />
                  <span className="addr num">{shorten(address)}</span>
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </span>
            </div>
          )}
        </div>
        {!isNonEvm && (
          <div className="mm-hero">
              {balances ? (
                <>
                  <span className="mm-fiat">{usd(worth.total)}</span>
                  <span className="mm-sub">
                    {chain ? `Held on ${chain.name}` : "Select a network"}
                  </span>

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
                <span style={{ display: "block", width: 200, maxWidth: "70%" }}>
                  <SkeletonLines count={1} />
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
        )}
      </section>

      {selected && selected.kind === "ton" && (
        <TonPanel userId={user?._id} network={selected.network} evmAddress={address} />
      )}

      {selected && selected.kind === "solana" && (
        <SolanaPanel userId={user?._id} network={selected.network} evmAddress={address} />
      )}

      {selected && selected.kind === "tron" && (
        <TronPanel userId={user?._id} network={selected.network} evmAddress={address} />
      )}

      {selected && selected.kind === "utxo" && (
        <UtxoPanel userId={user?._id} coin={selected.coin} network={selected.network} evmAddress={address} />
      )}

      {isBitcoin && (
        <BitcoinPanel
          userId={user?._id}
          network={selected.chainId === "bitcoin" ? "mainnet" : "testnet"}
          evmAddress={address}
        />
      )}

      {!isNonEvm && (
        <>
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

          <section className="card card-flush mm-panel">
            <div className="tabs mm-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={tab === "tokens"}
                className="tab"
                onClick={() => setTab("tokens")}
              >
                Tokens
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === "activity"}
                className="tab"
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
                      const verified = isVerifiedRow(b);
                      const price = verified ? usdPrices[String(b.symbol).toUpperCase()] : undefined;
                      const value =
                        !b.unknown && Number.isFinite(price) ? Number(b.amount) * price : null;
                      const impersonates =
                        !verified &&
                        (chain?.tokens || []).some(
                          (t) =>
                            String(t.symbol).toUpperCase() === String(b.symbol).toUpperCase() &&
                            String(t.address).toLowerCase() !== String(b.address).toLowerCase()
                        )
                          ? b.symbol
                          : null;
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
                            symbol={verified ? b.symbol : b.address || b.symbol}
                            native={b.native}
                            unknown={b.unknown}
                          />
                          <span className="mm-row-main">
                            <span className="mm-row-name">
                              {b.symbol}
                              {b.custom && (
                                <span className="lw-label" style={{ letterSpacing: "0.12em" }}>
                                  {impersonates ? "unverified" : "added"}
                                </span>
                              )}
                            </span>
                            {impersonates && (
                              <span className="mm-row-note warn">
                                Calls itself {impersonates}, but this is not the verified{" "}
                                {impersonates} contract on {chain ? chain.name : "this network"}.
                                Anyone can deploy a token with any name.
                              </span>
                            )}
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
                  error={txsError}
                  onRetry={() => loadTxs()}
                  chain={chain}
                  chains={chains}
                  onReceive={() => {
                    setTab("tokens");
                    setPanel("receive");
                  }}
                />
              </div>
            )}
          </section>
        </>
      )}

      {address && <RampCard address={address} />}

      {!isNonEvm && panel && (
        <DetailPane
          key={panel}
          view={panel}
          crumb={panelTitle}
          label={panelTitle}
          onBack={() => setPanel(null)}
        >
          <PageHeader
            title={panelTitle}
            action={
              <Button variant="ghost" icon title="Close" onClick={() => setPanel(null)}>
                <X size={15} />
              </Button>
            }
          />
          <section className="card">
            {panel === "send" && chain && (
              <SendForm
                key={chain.chainId}
                address={address}
                chain={chain}
                tokens={chainTokens}
                onSent={() => {
                  setPanel(null);
                  setTab("activity");
                  loadTxs();
                  loadBalances();
                }}
                onConfirmed={() => {
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
                key={chain.chainId}
                chain={chain}
                mainAddress={address}
                sweepDestination={user?.crypto?.sweepDestination}
                onSwept={() => {
                  loadBalances();
                  loadTxs();
                }}
              />
            )}
          </section>
        </DetailPane>
      )}

      {detail && (
        <HoldingDetail
          balance={detail}
          chain={chain}
          price={
            isVerifiedRow(detail) ? usdPrices[String(detail.symbol).toUpperCase()] : undefined
          }
          onRemove={detail.custom ? () => removeToken(detail) : null}
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

export default function WalletPage() {
  return (
    <ToastProvider>
      <WalletInner />
    </ToastProvider>
  );
}
