import { useEffect, useMemo, useRef, useState } from "react";
import { ethers } from "ethers";
import { Check, ChevronDown, Globe } from "lucide-react";
import { getProvider } from "./provider";

const LAST_CHAIN_KEY = "ledgerwatch.wallet.lastChainId";

export function rememberChain(chainId) {
  try {
    localStorage.setItem(LAST_CHAIN_KEY, String(chainId));
  } catch {
  }
}

function savedChain() {
  try {
    return localStorage.getItem(LAST_CHAIN_KEY) || sessionStorage.getItem(LAST_CHAIN_KEY);
  } catch {
    return null;
  }
}

export function recallChain(chains, preferredChainId) {
  const list = chains || [];
  const saved = savedChain();
  if (saved) {
    const hit = list.find((c) => String(c.chainId) === saved);
    if (hit) return hit.chainId;
  }
  if (preferredChainId != null) {
    const preferred = list.find((c) => String(c.chainId) === String(preferredChainId));
    if (preferred) return preferred.chainId;
  }
  const mainnet = list.find((c) => !c.testnet);
  if (mainnet) return mainnet.chainId;
  return list.length ? list[0].chainId : null;
}

export default function NetworkSwitcher({ chains, chainId, address, onChange }) {
  const [open, setOpen] = useState(false);
  const [balances, setBalances] = useState({});
  const boxRef = useRef(null);

  const active = chains.find((c) => c.chainId === chainId) || null;
  const testnets = useMemo(() => chains.filter((c) => c.testnet), [chains]);
  const mainnets = useMemo(() => chains.filter((c) => !c.testnet), [chains]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const requested = useRef(new Set());

  useEffect(() => {
    requested.current = new Set();
    setBalances({});
  }, [address]);

  useEffect(() => {
    if (!open || !address) return;
    let live = true;
    chains.forEach(async (c) => {
      if (c.kind && c.kind !== "evm") return;
      if (requested.current.has(c.chainId)) return;
      requested.current.add(c.chainId);
      try {
        const wei = await getProvider(c.chainId).getBalance(address);
        if (live) {
          setBalances((b) => ({ ...b, [c.chainId]: ethers.formatEther(wei) }));
        }
      } catch {
        requested.current.delete(c.chainId);
        if (live) setBalances((b) => ({ ...b, [c.chainId]: null }));
      }
    });
    return () => {
      live = false;
    };
  }, [open, address, chains]);

  function pick(chain) {
    commit(chain);
  }

  function commit(chain) {
    rememberChain(chain.chainId);
    onChange(chain.chainId);
    setOpen(false);
  }

  const balanceLabel = (c) => {
    const b = balances[c.chainId];
    if (b === undefined) return "…";
    if (b === null) return "unavailable";
    return `${Number(b).toLocaleString(undefined, { maximumFractionDigits: 4 })} ${c.nativeSymbol}`;
  };

  return (
    <div className="net-switcher" ref={boxRef}>
      <button
        type="button"
        className={`net-trigger${active && !active.testnet ? " mainnet" : ""}`}
        onClick={() => setOpen((o) => !o)}
        title="Switch network"
      >
        <Globe size={14} />
        <span>{active ? active.name : "Select network"}</span>
        <ChevronDown size={14} />
      </button>

      {open && (
        <div className="net-menu">
          {mainnets.length > 0 && (
            <Group
              label="Networks"
              hint=""
              chains={mainnets}
              chainId={chainId}
              onPick={pick}
              balanceLabel={balanceLabel}
            />
          )}
          <Group
            label="Test networks"
            hint=""
            chains={testnets}
            chainId={chainId}
            onPick={pick}
            balanceLabel={balanceLabel}
          />
          <p className="net-note">
            One address, every network. Your wallet address is the same on all of these, so you do
            not need a separate wallet per chain.
            <br />
            <strong>Balances are per network and do not move between them.</strong> Funds shown on
            one chain stay there; sending to your own address will not carry them across. Moving
            assets between networks needs a bridge.
          </p>
        </div>
      )}
    </div>
  );
}

function Group({ label, hint, chains, chainId, onPick, balanceLabel, danger }) {
  if (!chains.length) return null;
  return (
    <div className={`net-group${danger ? " danger" : ""}`}>
      <div className="net-group-head">
        <span className="overline">{label}</span>
        {hint ? <span className="muted caption">{hint}</span> : null}
      </div>
      {chains.map((c) => (
        <button
          key={c.chainId}
          type="button"
          className={`net-item${c.chainId === chainId ? " active" : ""}`}
          onClick={() => onPick(c)}
        >
          <span className="net-item-name">
            {c.name}
            {c.dex && <span className="net-dex-chip">swaps</span>}
          </span>
          <span className="net-item-bal num">{balanceLabel(c)}</span>
          {c.chainId === chainId && <Check size={14} />}
        </button>
      ))}
    </div>
  );
}
