import { describe, it, expect, beforeEach } from "vitest";

const local = new Map();
const session = new Map();
const storage = (map) => ({
  getItem: (k) => (map.has(k) ? map.get(k) : null),
  setItem: (k, v) => map.set(k, String(v)),
  removeItem: (k) => map.delete(k),
});
globalThis.localStorage = storage(local);
globalThis.sessionStorage = storage(session);

const { recallChain, rememberChain } = await import("../NetworkSwitcher");

const CHAINS = [
  { chainId: 11155111, testnet: true, name: "Ethereum Sepolia" },
  { chainId: 84532, testnet: true, name: "Base Sepolia" },
  { chainId: 1, testnet: false, name: "Ethereum" },
  { chainId: 8453, testnet: false, name: "Base" },
];

describe("LW-124 — the wallet opens on a mainnet, and remembers the network chosen", () => {
  beforeEach(() => {
    local.clear();
    session.clear();
  });

  it("opens on the network the server names as the default", () => {
    expect(recallChain(CHAINS, 8453)).toBe(8453);
  });

  it("opens on the first mainnet, never the first testnet, when there is no default", () => {
    expect(recallChain(CHAINS)).toBe(1);
  });

  it("only opens on a testnet when nothing else is available", () => {
    expect(recallChain(CHAINS.filter((c) => c.testnet))).toBe(11155111);
  });

  it("prefers the network the user chose, in a later session too", () => {
    rememberChain(84532);
    expect(local.get("ledgerwatch.wallet.lastChainId")).toBe("84532");
    session.clear();
    expect(recallChain(CHAINS, 8453)).toBe(84532);
  });

  it("still honours a choice saved by the earlier, per-tab version", () => {
    session.set("ledgerwatch.wallet.lastChainId", "1");
    expect(recallChain(CHAINS, 8453)).toBe(1);
  });

  it("ignores a saved network that is no longer offered", () => {
    rememberChain(999);
    expect(recallChain(CHAINS, 8453)).toBe(8453);
  });
});
