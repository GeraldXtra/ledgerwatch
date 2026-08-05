import { useEffect, useMemo, useRef, useState } from "react";
import { ethers } from "ethers";
import { Check, ChevronDown, Globe, TriangleAlert } from "lucide-react";
import { getProvider } from "./provider";

/**
 * Network switcher, grouped Testnets / Mainnets.
 *
 * Two things this deliberately makes obvious:
 *
 * 1. THE SAME ADDRESS WORKS ON EVERY EVM CHAIN. People routinely assume they need
 *    a separate wallet per network and create several, then cannot find their
 *    funds. Said in plain words rather than left to be inferred.
 *
 * 2. MAINNET IS REAL MONEY. Mainnet chains only appear when ENABLE_MAINNET is on,
 *    and when they do they are visually separated, never mixed into the same list
 *    as testnets — the two are one careless click apart otherwise.
 */

const LAST_CHAIN_KEY = "ledgerwatch.wallet.lastChainId";

/** Remember the chain for the session, so a reload does not bounce to the default. */
export function rememberChain(chainId) {
  try {
    sessionStorage.setItem(LAST_CHAIN_KEY, String(chainId));
  } catch {
    /* private mode — the default is a fine fallback */
  }
}

export function recallChain(chains) {
  try {
    const saved = Number(sessionStorage.getItem(LAST_CHAIN_KEY));
    if (saved && chains.some((c) => c.chainId === saved)) return saved;
  } catch {
    /* ignore */
  }
  return chains.length ? chains[0].chainId : null;
}

export default function NetworkSwitcher({ chains, chainId, address, onChange }) {
  const [open, setOpen] = useState(false);
  const [balances, setBalances] = useState({});
  const [confirming, setConfirming] = useState(null); // chain awaiting typed confirm
  const [typed, setTyped] = useState("");
  const boxRef = useRef(null);

  const active = chains.find((c) => c.chainId === chainId) || null;
  const testnets = useMemo(() => chains.filter((c) => c.testnet), [chains]);
  const mainnets = useMemo(() => chains.filter((c) => !c.testnet), [chains]);

  // Close on an outside click, like the other menus in the app.
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Native balance per chain, so the switcher answers "where are my funds?"
  // without visiting each network. Best effort: a chain whose RPC is unwell
  // simply shows no figure rather than blocking the menu.
  useEffect(() => {
    if (!open || !address) return;
    let live = true;
    chains.forEach(async (c) => {
      if (balances[c.chainId] !== undefined) return;
      try {
        const wei = await getProvider(c.chainId).getBalance(address);
        if (live) {
          setBalances((b) => ({ ...b, [c.chainId]: ethers.formatEther(wei) }));
        }
      } catch {
        if (live) setBalances((b) => ({ ...b, [c.chainId]: null }));
      }
    });
    return () => {
      live = false;
    };
  }, [open, address, chains, balances]);

  function pick(chain) {
    // Switching to real money is a decision, not a menu selection.
    if (!chain.testnet) {
      setConfirming(chain);
      setTyped("");
      return;
    }
    commit(chain);
  }

  function commit(chain) {
    rememberChain(chain.chainId);
    onChange(chain.chainId);
    setOpen(false);
    setConfirming(null);
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
          {confirming ? (
            <div className="net-confirm">
              <div className="against-note">
                <TriangleAlert size={15} />
                <span>
                  <strong>{confirming.name} is a real network.</strong> Transactions here move real
                  money and cannot be reversed by anyone. Type <code>MAINNET</code> to continue.
                </span>
              </div>
              <input
                className="input"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder="Type MAINNET"
                autoFocus
              />
              <div className="row" style={{ justifyContent: "flex-end" }}>
                <button type="button" className="btn btn-ghost" onClick={() => setConfirming(null)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={typed.trim().toUpperCase() !== "MAINNET"}
                  onClick={() => commit(confirming)}
                >
                  Switch to {confirming.name}
                </button>
              </div>
            </div>
          ) : (
            <>
              <Group
                label="Testnets"
                hint="Free test funds. Nothing here is worth money."
                chains={testnets}
                chainId={chainId}
                onPick={pick}
                balanceLabel={balanceLabel}
              />
              {mainnets.length > 0 && (
                <Group
                  label="Mainnets"
                  hint="Real funds. Every transaction is irreversible."
                  danger
                  chains={mainnets}
                  chainId={chainId}
                  onPick={pick}
                  balanceLabel={balanceLabel}
                />
              )}
              <p className="net-note">
                One address, every network. Your wallet address is the same on all of these — you do
                not need a separate wallet per chain, only funds on the chain you want to use.
              </p>
            </>
          )}
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
        <span className="muted caption">{hint}</span>
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
