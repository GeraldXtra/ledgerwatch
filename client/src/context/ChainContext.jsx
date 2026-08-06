import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { fetchChains } from "../features/wallet/walletApi";
import { rememberChain, recallChain } from "../features/wallet/NetworkSwitcher";

/**
 * ONE CHAIN SELECTION, SHARED BY THE WALLET AND MARKET WATCH.
 *
 * Both screens used to keep their own `chainId` state and each fetched the chain
 * list separately. Session memory existed (`rememberChain`/`recallChain`) but was
 * only read on mount, and Market Watch read it ONLY in live mode — so the two
 * could sit on different networks while both looked authoritative. On a screen
 * where the chain decides which balance you are looking at and which network a
 * transaction lands on, "usually agrees" is not good enough.
 *
 * Holding it here makes disagreement impossible by construction rather than by
 * convention: there is one value, and both pages render from it.
 *
 * The session store is still `rememberChain`/`recallChain` — this is a single
 * source of truth in memory, not a second store on disk.
 */

const ChainContext = createContext(null);

export function ChainProvider({ children }) {
  const [chains, setChains] = useState([]);
  const [chainId, setChainIdState] = useState(null);
  const [enableMainnet, setEnableMainnet] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Fetched ONCE for the whole app, replacing the two page-level calls.
  useEffect(() => {
    let live = true;
    fetchChains()
      .then((d) => {
        if (!live) return;
        // Mainnets are filtered out unless the server says they are enabled, so
        // a disabled mainnet can never appear in a picker.
        const usable = (d.chains || []).filter((c) => c.testnet || d.enableMainnet);
        setChains(usable);
        setEnableMainnet(Boolean(d.enableMainnet));
        setChainIdState((prev) => prev || recallChain(usable));
        setError("");
      })
      .catch((err) => {
        if (!live) return;
        setChains([]);
        // Named, not swallowed: an empty switcher with no explanation looks like
        // the app has no networks rather than like a failed request.
        setError(err?.response?.data?.error || "Could not load the network list.");
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, []);

  /** The one way to change chain. Writes through to the existing session store. */
  const setChainId = useCallback((next) => {
    const id = Number(next);
    if (!id) return;
    setChainIdState(id);
    rememberChain(id);
  }, []);

  const chain = useMemo(
    () => chains.find((c) => c.chainId === chainId) || null,
    [chains, chainId]
  );

  const value = useMemo(
    () => ({ chains, chainId, chain, setChainId, enableMainnet, loading, error }),
    [chains, chainId, chain, setChainId, enableMainnet, loading, error]
  );

  return <ChainContext.Provider value={value}>{children}</ChainContext.Provider>;
}

export function useChain() {
  const ctx = useContext(ChainContext);
  if (!ctx) {
    // A hard error rather than a silent default: rendering a chain-dependent
    // screen outside the provider would show the wrong network, which is exactly
    // the class of bug this context exists to prevent.
    throw new Error("useChain must be used inside <ChainProvider>");
  }
  return ctx;
}
