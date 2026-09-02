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

  /**
   * Native balance per chain, so the switcher answers "where are my funds?"
   * without visiting each network. Best effort: a chain whose RPC is unwell
   * simply shows no figure rather than blocking the menu.
   *
   * REQUESTED ONCE PER CHAIN. This effect previously listed `balances` as a
   * dependency while also calling `setBalances`, so every arriving balance
   * re-ran it — and a chain still IN FLIGHT has no entry in `balances` yet, so
   * the `!== undefined` guard missed and fired a duplicate request. Five chains
   * trickling in issued up to 5+4+3+2+1 calls instead of 5.
   *
   * That was not merely wasteful. Measured against the live endpoints, this
   * machine serves 8 concurrent RPC connections comfortably but fails ALL of
   * them at twelve — Alchemy, Cloudflare and publicnode timing out at the TCP
   * connect layer simultaneously, which is a local connection ceiling rather
   * than three providers rate-limiting at once. The storm put the switcher
   * squarely in that range, and is the likeliest source of the intermittent
   * "fetch failed".
   *
   * `requested` is a ref, not state: it must be updated the moment a request
   * STARTS, and a state update would not be visible to the other iterations of
   * this same pass.
   */
  const requested = useRef(new Set());

  // A different wallet means the cached figures belong to somebody else.
  useEffect(() => {
    requested.current = new Set();
    setBalances({});
  }, [address]);

  useEffect(() => {
    if (!open || !address) return;
    let live = true;
    chains.forEach(async (c) => {
      // Bitcoin is in this menu but is not an EVM chain: it has no JSON-RPC
      // provider and getBalance would throw on every open. Its balance lives in
      // BitcoinPanel, which reads it from a different API entirely.
      if (c.kind === "bitcoin") return;
      if (requested.current.has(c.chainId)) return;
      requested.current.add(c.chainId);
      try {
        const wei = await getProvider(c.chainId).getBalance(address);
        if (live) {
          setBalances((b) => ({ ...b, [c.chainId]: ethers.formatEther(wei) }));
        }
      } catch {
        // Allow a retry on the next open: a failure here is usually transient,
        // and leaving it marked as requested would show a permanent blank.
        requested.current.delete(c.chainId);
        if (live) setBalances((b) => ({ ...b, [c.chainId]: null }));
      }
    });
    return () => {
      live = false;
    };
  }, [open, address, chains]);

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
              {/* BOTH HALVES, ALWAYS TOGETHER.
                  This said only the first sentence, and a user reasonably
                  concluded that because the address is the same everywhere,
                  sending to it would let them choose the destination network.
                  They sent 80 USDC to their own address expecting it to land on
                  another chain; it stayed put and cost a fee. The second
                  sentence is the part that was missing. */}
              <p className="net-note">
                One address, every network. Your wallet address is the same on all of these, so you do
                not need a separate wallet per chain.
                <br />
                <strong>Balances are per network and do not move between them.</strong> Funds shown
                on one chain stay there; sending to your own address will not carry them across.
                Moving assets between networks needs a bridge.
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
