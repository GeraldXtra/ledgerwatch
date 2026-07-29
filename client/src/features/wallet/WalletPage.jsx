import { useCallback, useEffect, useState } from "react";
import { ethers } from "ethers";
import {
  Copy,
  Check,
  Droplets,
  PlusCircle,
  DownloadCloud,
  RefreshCw,
  Trash2,
  Wallet as WalletIcon,
} from "lucide-react";
import {
  Button,
  Card,
  PageHeader,
  Segmented,
  SkeletonLines,
  ToastProvider,
} from "../../components/ui";
import { getProvider, ERC20_ABI } from "./provider";
import { hasWallet, getStoredAddress, clearWallet } from "./keystore";
import { fetchChains, fetchTxs, clearAddress, updateTxStatus } from "./walletApi";
import CreateWalletModal from "./CreateWalletModal";
import ImportWalletModal from "./ImportWalletModal";
import SendForm from "./SendForm";
import ReceivePanel from "./ReceivePanel";
import TxHistory from "./TxHistory";

function shorten(a) {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "";
}

function WalletInner() {
  const [chains, setChains] = useState([]);
  const [chainId, setChainId] = useState(null);
  const [address, setAddress] = useState(getStoredAddress());
  const [subtab, setSubtab] = useState("send");
  const [balances, setBalances] = useState(null);
  const [balLoading, setBalLoading] = useState(false);
  const [txs, setTxs] = useState([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const chain = chains.find((c) => c.chainId === chainId) || null;

  // Load the config-driven chain list once. The server already filters disabled
  // chains; we filter again here so a mainnet entry can never surface client-side
  // unless ENABLE_MAINNET is explicitly on (defence in depth).
  useEffect(() => {
    fetchChains()
      .then((d) => {
        const usable = (d.chains || []).filter((c) => c.testnet || d.enableMainnet);
        setChains(usable);
        if (usable.length) setChainId((prev) => prev || usable[0].chainId);
      })
      .catch(() => setChains([]));
  }, []);

  const loadBalances = useCallback(async () => {
    if (!address || !chain) return;
    setBalLoading(true);
    try {
      const provider = getProvider(chain.chainId);
      const native = await provider.getBalance(address);
      const rows = [{ symbol: chain.nativeSymbol, amount: ethers.formatEther(native), native: true }];
      for (const t of chain.tokens || []) {
        try {
          const c = new ethers.Contract(t.address, ERC20_ABI, provider);
          const bal = await c.balanceOf(address);
          rows.push({ symbol: t.symbol, amount: ethers.formatUnits(bal, t.decimals), native: false });
        } catch {
          rows.push({ symbol: t.symbol, amount: "0", native: false });
        }
      }
      setBalances(rows);
    } catch {
      setBalances(null);
    } finally {
      setBalLoading(false);
    }
  }, [address, chain]);

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
  }, [loadBalances, loadTxs]);

  function onWalletReady(addr) {
    setAddress(addr);
    setCreateOpen(false);
    setImportOpen(false);
  }

  async function removeWallet() {
    if (!window.confirm("Remove this wallet from this device? Make sure your recovery phrase is backed up — this cannot be undone here.")) {
      return;
    }
    clearWallet();
    await clearAddress().catch(() => {});
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

        <Card>
          <div className="wallet-intro">
            <div className="wallet-intro-icon"><WalletIcon size={22} /></div>
            <h3 className="section-title">Create or import a wallet</h3>
            <p className="muted" style={{ maxWidth: "52ch", margin: "0 auto" }}>
              Keys are generated and encrypted in your browser. Only the encrypted keystore is
              stored on this device — the plaintext key never touches our servers. Testnet chains
              only; mainnet is disabled behind a security audit.
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
        title="Testnet wallet"
        support="Non-custodial · keys encrypted on this device · you approve every transaction."
      />

      <Card>
        <div className="wallet-head">
          <div className="wallet-head-left">
            <span className="testnet-badge">TESTNET ONLY</span>
            <button type="button" className="wallet-address-btn" onClick={copyAddr} title="Copy address">
              <span className="num">{shorten(address)}</span>
              {copied ? <Check size={13} /> : <Copy size={13} />}
            </button>
          </div>
          <div className="wallet-head-right">
            <label className="chain-switcher">
              <select
                value={chainId || ""}
                onChange={(e) => setChainId(Number(e.target.value))}
                className="select"
              >
                {chains.map((c) => (
                  <option key={c.chainId} value={c.chainId}>{c.name}</option>
                ))}
              </select>
            </label>
            <Button variant="ghost" icon title="Refresh balances" onClick={loadBalances}>
              <RefreshCw size={15} />
            </Button>
            <Button variant="ghost" icon title="Remove wallet" onClick={removeWallet}>
              <Trash2 size={15} />
            </Button>
          </div>
        </div>

        <div className="wallet-balances">
          {balLoading && !balances ? (
            <SkeletonLines count={2} />
          ) : balances ? (
            balances.map((b) => (
              <div key={b.symbol} className={`balance-tile${b.native ? " primary" : ""}`}>
                <span className="balance-amount num">{Number(b.amount).toLocaleString(undefined, { maximumFractionDigits: 6 })}</span>
                <span className="balance-symbol">{b.symbol}</span>
              </div>
            ))
          ) : (
            <p className="muted small">Could not load balances. Try refresh.</p>
          )}
        </div>

        {chain?.faucet && (
          <a className="faucet-link" href={chain.faucet} target="_blank" rel="noopener noreferrer">
            <Droplets size={14} /> Need funds? Open the {chain.name} faucet
          </a>
        )}
      </Card>

      <Card>
        <Segmented
          value={subtab}
          onChange={setSubtab}
          options={[
            { id: "send", label: "Send" },
            { id: "receive", label: "Receive" },
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
          {subtab === "history" && <TxHistory txs={txs} chain={chain} onReceive={() => setSubtab("receive")} />}
        </div>
      </Card>
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
