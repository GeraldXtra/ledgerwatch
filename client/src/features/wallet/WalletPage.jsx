import { useCallback, useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import {
  Copy,
  Check,
  Droplets,
  History,
  PlusCircle,
  DownloadCloud,
  Info,
  RefreshCw,
  Trash2,
  TriangleAlert,
  Wallet as WalletIcon,
  X,
} from "lucide-react";
import { Link } from "react-router-dom";
import {
  Button,
  Card,
  PageHeader,
  Segmented,
  SkeletonLines,
  ToastProvider,
} from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { getProvider, ERC20_ABI, rpcErrorReason } from "./provider";
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
} from "./walletApi";
import NetworkSwitcher, { rememberChain, recallChain } from "./NetworkSwitcher";
import MainnetBanner from "./MainnetBanner";
import CreateWalletModal from "./CreateWalletModal";
import ImportWalletModal from "./ImportWalletModal";
import AddTokenModal from "./AddTokenModal";
import SendForm from "./SendForm";
import ReceivePanel from "./ReceivePanel";
import CollectedPanel from "./CollectedPanel";
import TxHistory from "./TxHistory";

function shorten(a) {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "";
}

function WalletInner() {
  const { user, applyUser } = useAuth();
  const [chains, setChains] = useState([]);
  const [chainId, setChainId] = useState(null);
  const [address, setAddress] = useState(getStoredAddress());
  const [legacy, setLegacy] = useState(() => getLegacyWallet());
  const [claiming, setClaiming] = useState(false);
  const [hideZero, setHideZero] = useState(false);
  // Re-read rather than captured once: revealing the phrase in Settings flips
  // this, and coming back to the wallet should not still be nagging.
  const [backedUp, setBackedUp] = useState(() => isBackedUp());
  const [backupDismissed, setBackupDismissed] = useState(false);
  const [addTokenOpen, setAddTokenOpen] = useState(false);
  const [subtab, setSubtab] = useState("send");
  const [balances, setBalances] = useState(null);
  const [balLoading, setBalLoading] = useState(false);
  // Why the last balance read failed, when it did. Shown instead of a bare
  // "try refresh", which gives the user nothing to act on.
  const [balError, setBalError] = useState(null);
  const [txs, setTxs] = useState([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const chain = chains.find((c) => c.chainId === chainId) || null;

  // A zero native balance means nothing can be sent from this chain at all.
  // Surfaced persistently rather than at the moment of signing. An UNKNOWN
  // balance is not a zero one — warning "no gas" when the figure simply could
  // not be read would be a guess presented as a fact.
  const noGas = Boolean(
    balances && balances.some((b) => b.native && !b.unknown && Number(b.amount) === 0)
  );

  // The native tile is never hidden — it pays for everything, so a zero there is
  // the single most important number on this screen. Unknown balances are never
  // hidden either: "hide zero" must not quietly swallow a figure we failed to
  // read, since that is the one the user most needs to see.
  const visibleBalances = (balances || []).filter(
    (b) => !hideZero || b.native || b.unknown || Number(b.amount) > 0
  );

  // Keystores are scoped per account, so switching account changes which wallet
  // (if any) belongs to this page. Re-read on identity change rather than
  // trusting the value captured at mount.
  useEffect(() => {
    setAddress(getStoredAddress());
    setLegacy(getLegacyWallet());
    setBalances(null);
    setTxs([]);
  }, [user?._id]);

  // Load the config-driven chain list once. The server already filters disabled
  // chains; we filter again here so a mainnet entry can never surface client-side
  // unless ENABLE_MAINNET is explicitly on (defence in depth).
  useEffect(() => {
    fetchChains()
      .then((d) => {
        const usable = (d.chains || []).filter((c) => c.testnet || d.enableMainnet);
        setChains(usable);
        // Restore the chain chosen earlier this session rather than snapping back
        // to the first in the list on every reload.
        if (usable.length) setChainId((prev) => prev || recallChain(usable));
      })
      .catch(() => setChains([]));
  }, []);

  // Curated (verified on-chain) tokens for this chain, plus anything the user
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
      const rows = [{ symbol: chain.nativeSymbol, amount: ethers.formatEther(native), native: true }];
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
           * like a genuine empty balance — so an RPC failure looked identical to
           * having spent everything. Someone could reasonably conclude their
           * funds were gone. An unread balance says so.
           *
           * The reason is carried on the ROW: a token-only failure never reaches
           * the outer catch, so without this the tile said "could not be read"
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

    // Reconcile stragglers: a send whose confirmation landed after a reload is still
    // recorded as "pending". Ask the chain for a receipt and settle it. Uses the
    // allowlisted eth_getTransactionReceipt via the proxy; failures are ignored.
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
      /* leave them pending — the row still deep-links to the explorer */
    }
  }, [address, chain]);

  useEffect(() => {
    loadBalances();
    loadTxs();
    // Backup state can change on another screen (Settings → Wallet backup), so
    // it is re-read whenever this page becomes active rather than trusted from
    // the first render.
    setBackedUp(isBackedUp());
  }, [loadBalances, loadTxs]);

  function onWalletReady(addr) {
    setAddress(addr);
    setLegacy(null);
    setCreateOpen(false);
    setImportOpen(false);
  }

  // Take over the pre-scoping wallet for THIS account. Explicit and one time:
  // the legacy entry is removed on success so a second account cannot claim the
  // same wallet, which is the cross-account leak this whole change fixes.
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
      /* the modal stays open; the user can retry or cancel */
      console.error("add token failed:", err?.response?.data?.error || err.message);
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
    if (!window.confirm("Remove this wallet from this device? Make sure your recovery phrase is backed up — this cannot be undone here.")) {
      return;
    }
    clearWallet();
    await clearAddress().catch(() => {});
    // Keep context in step, or the "has a wallet but not on this device" card
    // would appear immediately after deliberately removing it.
    if (applyUser && user) applyUser({ ...user, walletAddress: null });
    setAddress(null);
    setBalances(null);
    setTxs([]);
  }

  async function copyAddr() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* visible to copy manually */
    }
  }

  // ---- Opt-in gate: no wallet yet ----
  if (!hasWallet() || !address) {
    return (
      <>
        <PageHeader
          eyebrow="WALLET"
          title="Testnet wallet"
          support="An optional, non-custodial wallet. Your simulated portfolio stays your default — this is a separate, real testnet tool."
        />
        <span className="testnet-badge">TESTNET ONLY · no real funds</span>

        {/* This account already registered an address, but its keystore is not in
            this browser — a different machine, or storage was cleared. Say so,
            rather than implying the account has no wallet. */}
        {user?.walletAddress && (
          <Card>
            <div className="wallet-elsewhere">
              <span className="icon-tile neutral">
                <History size={16} />
              </span>
              <div className="grow">
                <div className="card-title">This account has a wallet, but not on this device</div>
                <p className="muted small" style={{ margin: "4px 0 8px" }}>
                  It is registered as <code className="num">{shorten(user.walletAddress)}</code>.
                  Keys only ever live in the browser they were made in, so import it here with its
                  recovery phrase to use it again.
                </p>
                <Button variant="primary" onClick={() => setImportOpen(true)}>
                  <DownloadCloud size={15} /> Import with recovery phrase
                </Button>
              </div>
            </div>
          </Card>
        )}

        {/* A wallet left over from before keystores were scoped per account. Only
            ever adopted on an explicit click. */}
        {legacy && (
          <Card>
            <div className="wallet-elsewhere">
              <span className="icon-tile neutral">
                <WalletIcon size={16} />
              </span>
              <div className="grow">
                <div className="card-title">There is an earlier wallet in this browser</div>
                <p className="muted small" style={{ margin: "4px 0 8px" }}>
                  <code className="num">{shorten(legacy.address)}</code> was created before wallets
                  were kept separate per account, so it does not belong to any account yet. Claim it
                  for <strong>{user?.email}</strong> and it becomes this account's wallet, using the
                  password you originally set. Otherwise create a fresh one below.
                </p>
                <div className="row wrap">
                  <Button variant="primary" onClick={claimLegacy} disabled={claiming}>
                    <Check size={15} /> {claiming ? "Claiming…" : "Claim for this account"}
                  </Button>
                  <Button variant="ghost" onClick={discardLegacy} disabled={claiming}>
                    <Trash2 size={14} /> Forget it
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        )}

        <Card>
          <div className="wallet-intro">
            <div className="wallet-intro-icon"><WalletIcon size={22} /></div>
            <h3 className="section-title">Create or import a wallet</h3>
            <p className="muted" style={{ maxWidth: "52ch", margin: "0 auto" }}>
              Keys are generated and encrypted in your browser. Only the encrypted keystore is
              stored on this device — the plaintext key never touches our servers. Each account
              has its own wallet, so this one is separate from any other you have signed into.
              Testnet chains only; mainnet is disabled behind a security audit.
            </p>
            <div className="row" style={{ justifyContent: "center", marginTop: 16 }}>
              <Button variant="primary" onClick={() => setCreateOpen(true)}>
                <PlusCircle size={15} /> Create wallet
              </Button>
              <Button variant="secondary" onClick={() => setImportOpen(true)}>
                <DownloadCloud size={15} /> Import wallet
              </Button>
            </div>
          </div>
        </Card>

        {createOpen && <CreateWalletModal onClose={() => setCreateOpen(false)} onDone={onWalletReady} />}
        {importOpen && <ImportWalletModal onClose={() => setImportOpen(false)} onDone={onWalletReady} />}
      </>
    );
  }

  // ---- Active wallet ----
  return (
    <>
      <PageHeader
        eyebrow="WALLET"
        title={chain && !chain.testnet ? "Wallet" : "Testnet wallet"}
        support="Non-custodial · keys encrypted on this device · you approve every transaction."
      />

      <MainnetBanner chain={chain} />

      {/* A wallet whose phrase was never written down is one cleared browser
          away from being unrecoverable — not stolen, just gone, with the owner
          never having been given the thing that would have saved it. Dismissible
          per session, because nagging that cannot be silenced gets ignored, but
          it returns on the next visit until the phrase has actually been seen. */}
      {address && !backedUp && !backupDismissed && (
        <div className="backup-reminder">
          <TriangleAlert size={17} />
          <div className="grow">
            <strong>Back up this wallet</strong>
            <span className="muted small">
              You have not viewed your recovery phrase yet. Without it, clearing this browser or
              losing this device means the funds cannot be recovered — by you or by us.
            </span>
          </div>
          <div className="row">
            <Link className="btn btn-primary btn-sm" to="/app/settings?section=wallet-backup">
              Back up now
            </Link>
            <Button variant="ghost" icon title="Dismiss" onClick={() => setBackupDismissed(true)}>
              <X size={15} />
            </Button>
          </div>
        </div>
      )}

      <Card>
        <div className="wallet-head">
          <div className="wallet-head-left">
            {/* The badge has to follow the chain. A hardcoded "TESTNET ONLY"
                sitting above a mainnet balance would be the most dangerous
                label in the app. */}
            {chain && !chain.testnet ? (
              <span className="mainnet-badge">MAINNET · REAL FUNDS</span>
            ) : (
              <span className="testnet-badge">TESTNET ONLY</span>
            )}
            <button type="button" className="wallet-address-btn" onClick={copyAddr} title="Copy address">
              <span className="num">{shorten(address)}</span>
              {copied ? <Check size={13} /> : <Copy size={13} />}
            </button>
          </div>
          <div className="wallet-head-right">
            <NetworkSwitcher
              chains={chains}
              chainId={chainId}
              address={address}
              onChange={setChainId}
            />
            <Button variant="ghost" icon title="Refresh balances" onClick={loadBalances}>
              <RefreshCw size={15} />
            </Button>
            <Button variant="ghost" icon title="Remove wallet" onClick={removeWallet}>
              <Trash2 size={15} />
            </Button>
          </div>
        </div>

        <div className="row space-between wallet-token-bar">
          <label className="toggle-inline">
            <input
              type="checkbox"
              checked={hideZero}
              onChange={(e) => setHideZero(e.target.checked)}
            />
            <span className="muted small">Hide zero balances</span>
          </label>
          <Button variant="ghost" onClick={() => setAddTokenOpen(true)}>
            <PlusCircle size={14} /> Add token
          </Button>
        </div>

        <div className="wallet-balances">
          {balLoading && !balances ? (
            <SkeletonLines count={2} />
          ) : balances ? (
            visibleBalances.map((b) => (
              <div
                key={b.symbol}
                className={`balance-tile${b.native ? " primary" : ""}${b.unknown ? " unknown" : ""}`}
              >
                <span className="balance-amount num">
                  {b.unknown
                    ? "—"
                    : Number(b.amount).toLocaleString(undefined, { maximumFractionDigits: 6 })}
                </span>
                <span className="balance-symbol">
                  {b.symbol}
                  {/* The native token is what pays for every transaction, so it
                      is labelled as such and its emptiness is called out here
                      rather than discovered at signing time. */}
                  {b.native && <span className="balance-role">pays network fees</span>}
                  {/* Says "we could not read this", never a number. A failed read
                      shown as 0 would look exactly like an emptied wallet. */}
                  {b.unknown && (
                    <span className="balance-role" title={b.reason || undefined}>
                      {b.reason ? `unreadable: ${b.reason}` : "could not be read"}
                    </span>
                  )}
                </span>
              </div>
            ))
          ) : (
            <p className="muted small">
              Could not load balances{balError ? `: ${balError}` : ""}. Try refresh.
            </p>
          )}
        </div>

        {noGas && (
          <div className="against-note" style={{ marginTop: 12 }}>
            <TriangleAlert size={15} />
            <span>
              You hold no {chain?.nativeSymbol} on {chain?.name}, so no transaction can be sent
              from this network — not a transfer, not a sweep, not a trade. Token balances are
              unaffected.
              {chain?.testnet && chain?.faucet && (
                <>
                  {" "}
                  <a href={chain.faucet} target="_blank" rel="noopener noreferrer" className="linklike">
                    <Droplets size={13} style={{ verticalAlign: "-2px" }} /> Get free{" "}
                    {chain.nativeSymbol} from the {chain.name} faucet
                  </a>
                  .
                </>
              )}
            </span>
          </div>
        )}

        {chain?.faucet && (
          <a className="faucet-link" href={chain.faucet} target="_blank" rel="noopener noreferrer">
            <Droplets size={14} /> Need funds? Open the {chain.name} faucet
          </a>
        )}

        {/* Stated rather than implied. Someone holding Bitcoin or Solana will
            otherwise reasonably assume this wallet covers them. */}
        <p className="settings-note">
          <Info size={15} />
          This wallet is <strong>EVM only</strong> — Ethereum and chains compatible with it. Bitcoin,
          Solana, Cosmos and TON use different key derivation and signing and are not supported here.
        </p>
      </Card>

      <Card>
        <Segmented
          value={subtab}
          onChange={setSubtab}
          options={[
            { id: "send", label: "Send" },
            { id: "receive", label: "Receive" },
            { id: "collected", label: "Collected" },
            { id: "history", label: "History" },
          ]}
        />
        <div className="mt">
          {subtab === "send" && chain && (
            <SendForm
              address={address}
              chain={chain}
              onSent={() => {
                setSubtab("history");
                loadTxs();
                loadBalances();
              }}
              onConfirmed={() => {
                // Receipt landed — refresh so the row flips pending -> confirmed
                // and the balance reflects the settled transfer.
                loadTxs();
                loadBalances();
              }}
            />
          )}
          {subtab === "receive" && chain && <ReceivePanel address={address} chain={chain} />}
          {subtab === "collected" && chain && (
            <CollectedPanel
              chain={chain}
              mainAddress={address}
              sweepDestination={user?.crypto?.sweepDestination}
              onSwept={() => {
                // Swept funds land in this wallet, so both views are now stale.
                loadBalances();
                loadTxs();
              }}
            />
          )}
          {subtab === "history" && (
            <TxHistory txs={txs} chain={chain} chains={chains} onReceive={() => setSubtab("receive")} />
          )}
        </div>
      </Card>

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
