/**
 * Config-driven multi-chain registry for the non-custodial wallet.
 *
 * TESTNET ONLY by default. Mainnet entries exist but are gated behind
 * ENABLE_MAINNET === "true" (default false) and are filtered out both here and on
 * the client. Flipping that flag to expose real-money chains requires a security
 * audit — see README.
 *
 * RPC URLs come from Alchemy when ALCHEMY_API_KEY is set (kept server-side and
 * proxied so the key never reaches the browser), otherwise a public testnet RPC.
 * Everything is read from process.env at call time so dotenv is always applied.
 */

function alchemy(subdomain) {
  const key = process.env.ALCHEMY_API_KEY;
  return key ? `https://${subdomain}.g.alchemy.com/v2/${key}` : null;
}

// Circle's official testnet USDC addresses (6 decimals) so ERC-20 balances have
// something real to read on each chain.
const USDC = (address) => ({ symbol: "USDC", name: "USD Coin (test)", address, decimals: 6 });

function buildRegistry() {
  const mainnetEnabled = process.env.ENABLE_MAINNET === "true";

  return [
    // ---- Testnets (always enabled) ----
    {
      key: "sepolia",
      name: "Ethereum Sepolia",
      chainId: 11155111,
      rpc: alchemy("eth-sepolia") || "https://ethereum-sepolia-rpc.publicnode.com",
      explorer: "https://sepolia.etherscan.io",
      nativeSymbol: "ETH",
      decimals: 18,
      testnet: true,
      enabled: true,
      faucet: "https://www.alchemy.com/faucets/ethereum-sepolia",
      tokens: [USDC("0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238")],
    },
    {
      key: "base-sepolia",
      name: "Base Sepolia",
      chainId: 84532,
      rpc: alchemy("base-sepolia") || "https://sepolia.base.org",
      explorer: "https://sepolia.basescan.org",
      nativeSymbol: "ETH",
      decimals: 18,
      testnet: true,
      enabled: true,
      faucet: "https://www.alchemy.com/faucets/base-sepolia",
      tokens: [USDC("0x036CbD53842c5426634e7929541eC2318f3dCF7e")],
    },
    {
      key: "arbitrum-sepolia",
      name: "Arbitrum Sepolia",
      chainId: 421614,
      rpc: alchemy("arb-sepolia") || "https://sepolia-rollup.arbitrum.io/rpc",
      explorer: "https://sepolia.arbiscan.io",
      nativeSymbol: "ETH",
      decimals: 18,
      testnet: true,
      enabled: true,
      faucet: "https://www.alchemy.com/faucets/arbitrum-sepolia",
      tokens: [USDC("0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d")],
    },
    {
      key: "polygon-amoy",
      name: "Polygon Amoy",
      chainId: 80002,
      rpc: alchemy("polygon-amoy") || "https://rpc-amoy.polygon.technology",
      explorer: "https://amoy.polygonscan.com",
      nativeSymbol: "POL",
      decimals: 18,
      testnet: true,
      enabled: true,
      faucet: "https://www.alchemy.com/faucets/polygon-amoy",
      tokens: [USDC("0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582")],
    },
    {
      key: "optimism-sepolia",
      name: "Optimism Sepolia",
      chainId: 11155420,
      rpc: alchemy("opt-sepolia") || "https://sepolia.optimism.io",
      explorer: "https://sepolia-optimism.etherscan.io",
      nativeSymbol: "ETH",
      decimals: 18,
      testnet: true,
      enabled: true,
      faucet: "https://www.alchemy.com/faucets/optimism-sepolia",
      tokens: [USDC("0x5fd84259d66Cd46123540766Be93DFE6D43130D7")],
    },

    // ---- Mainnets (DISABLED unless ENABLE_MAINNET=true — requires an audit) ----
    {
      key: "ethereum",
      name: "Ethereum",
      chainId: 1,
      rpc: alchemy("eth-mainnet") || "https://ethereum-rpc.publicnode.com",
      explorer: "https://etherscan.io",
      nativeSymbol: "ETH",
      decimals: 18,
      testnet: false,
      enabled: mainnetEnabled,
      faucet: null,
      tokens: [],
    },
    {
      key: "base",
      name: "Base",
      chainId: 8453,
      rpc: alchemy("base-mainnet") || "https://mainnet.base.org",
      explorer: "https://basescan.org",
      nativeSymbol: "ETH",
      decimals: 18,
      testnet: false,
      enabled: mainnetEnabled,
      faucet: null,
      tokens: [],
    },
  ];
}

// Chains exposed to the client — enabled only, and WITHOUT the rpc URL (which may
// embed the Alchemy key). The client talks to chains exclusively via the proxy.
function listChains() {
  return buildRegistry()
    .filter((c) => c.enabled)
    .map(({ rpc, ...pub }) => ({ ...pub, hasKey: Boolean(process.env.ALCHEMY_API_KEY) }));
}

// Full chain record (incl. rpc) for server-side proxying. Returns null if the chain
// is unknown or disabled — so a disabled mainnet can never be proxied.
function getChain(chainId) {
  const id = Number(chainId);
  return buildRegistry().find((c) => c.chainId === id && c.enabled) || null;
}

module.exports = { listChains, getChain };
