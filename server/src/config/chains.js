/**
 * Config-driven multi-chain registry.
 *
 * ============================================================================
 *  MAINNET SAFETY — READ BEFORE FLIPPING ENABLE_MAINNET
 * ============================================================================
 *  Every mainnet entry below is DISABLED unless ENABLE_MAINNET === "true", and
 *  the default is false.
 *
 *  Do NOT enable mainnet in a public deployment until the key handling and
 *  signing paths have been reviewed by a competent third party. Those paths
 *  decrypt a private key in the browser and broadcast signed transactions. A
 *  defect there does not corrupt data or produce a wrong number on a screen —
 *  it moves somebody's money to an address nobody controls, and there is no
 *  refund, no chargeback and no support desk that can reverse it. Testnet funds
 *  are free and worthless, which is exactly why all development happens there.
 * ============================================================================
 *
 * ADDING A CHAIN IS ONE OBJECT. No code changes anywhere else.
 *
 * EVERY ADDRESS BELOW WAS VERIFIED AGAINST THE LIVE CHAIN, not from memory.
 * Each token had `symbol()` and `decimals()` read from its contract and matched
 * against what is written here; each router and quoter had `eth_getCode` confirm
 * real bytecode. 42 addresses across 12 chains. Re-check with the scratchpad
 * script whenever this file is edited.
 *
 * That pass caught three mistakes worth recording, because they are the shape of
 * error this file invites:
 *   - Ethereum Sepolia had NO Uniswap deployment at the canonical addresses I
 *     assumed. Removed, so that chain is paper only.
 *   - Arbitrum's USDT self-identifies as USD₮0. Relabelled to match the chain.
 *   - Polygon Amoy's documented public RPC is dead. Replaced with one that answers.
 *
 * An address that cannot be verified is ABSENT rather than guessed: a wrong token
 * address sends funds nowhere recoverable, while a missing one only costs the
 * ability to trade that asset here.
 *
 * RPC URLs come from Alchemy when ALCHEMY_API_KEY is set (kept server-side and
 * proxied so the key never reaches the browser), otherwise a public RPC.
 * Everything is read from process.env at call time so dotenv is always applied.
 *
 * EACH CHAIN CARRIES AN ORDERED LIST OF ENDPOINTS, NOT ONE.
 * The previous single-URL form (`alchemy(x) || publicNode`) picked its endpoint
 * once, at module load, and had nowhere to go when that endpoint failed. That is
 * exactly what broke the wallet: the Alchemy app behind this key has only the two
 * Ethereum networks switched on, so Base Sepolia — the DEFAULT wallet chain —
 * answered `403 BASE_SEPOLIA is not enabled for this app` on every single call,
 * permanently, while a perfectly healthy public node sat unused in the `||`.
 *
 * EVERY FALLBACK BELOW WAS VERIFIED, not assumed. Each was required to answer
 * `eth_chainId` with the CORRECT id — a fallback silently pointing at another
 * network would broadcast a signed transaction onto the wrong chain — and to
 * accept the same filtered `eth_getLogs` span the watchers use, since an endpoint
 * that serves balances but refuses log queries would leave payment detection
 * quietly broken while everything looked fine.
 *
 * Rejected during that pass, recorded so they are not retried:
 *   - https://rpc.sepolia.org           returns an HTML error page, not JSON.
 *   - https://1rpc.io/sepolia           caps eth_getLogs at 50 blocks (need 1500).
 *   - https://rpc-amoy.polygon.technology  dead host; this is the origin of the
 *     "fetch failed" in the logs — undici reports a connect failure with that
 *     bare string and hides the real reason on `err.cause`.
 */

function alchemy(subdomain) {
  const key = process.env.ALCHEMY_API_KEY;
  return key ? `https://${subdomain}.g.alchemy.com/v2/${key}` : null;
}

/**
 * Ordered endpoints for one chain, best first. Nulls drop out, so an absent
 * Alchemy key simply promotes the public node to primary instead of leaving a
 * hole. Order is preference, not fallback-only: every entry must be a fully
 * working endpoint for that chain on its own.
 */
function rpcList(...urls) {
  return urls.filter(Boolean);
}

const token = (symbol, name, address, decimals) => ({ symbol, name, address, decimals });

/**
 * How to move funds ONTO this chain from its L1.
 *
 * LedgerWatch does not and will not bridge. This is a signpost only: a plain
 * ERC-20 transfer cannot cross chains, and a user who tries anyway (by sending
 * to their own address, which is the natural guess since the address is the same
 * everywhere) burns gas and moves nothing. Pointing at the real tool is the
 * honest answer to "how do I get my USDC onto Base?".
 *
 * URLs VERIFIED REACHABLE, not recalled:
 *   - bridge.base.org is RETIRED. Both the bare host and /deposit now redirect to
 *     docs.base.org/base-chain/network-information/ecosystem — a documentation
 *     page, not a bridge. Superbridge is what actually serves a Base Sepolia
 *     bridge UI (72KB of app, HTTP 200).
 *   - portal.arbitrum.io/bridge answers a scripted request with a Cloudflare
 *     challenge (HTTP 403, 5.5KB). That is bot protection rather than a dead
 *     link, and bridge.arbitrum.io redirects to it, which is what identifies it
 *     as canonical. Flagged here because it is asserted, not proven, unlike the
 *     others.
 */
const bridge = (name, url) => ({ name, url });

// Uniswap V3 deploys SwapRouter02 and QuoterV2 at the same canonical addresses
// on Ethereum, Arbitrum, Optimism and Polygon. Base uses its own.
const UNIV3_CANONICAL = {
  type: "uniswap-v3",
  router: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
  quoter: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
  // Standard V3 tiers. Every one is quoted and the best is chosen; testnet
  // pools in particular are priced very differently tier to tier.
  feeTiers: [500, 3000, 10000],
};

function buildRegistry() {
  const mainnetEnabled = process.env.ENABLE_MAINNET === "true";

  // `rpc` stays as the preferred endpoint so every existing caller keeps working
  // unchanged; `rpcs` is the full ordered list for callers that can retry.
  return rawRegistry(mainnetEnabled).map((c) => ({ ...c, rpc: c.rpcs[0] }));
}

function rawRegistry(mainnetEnabled) {
  return [
    // ======================= TESTNETS (enabled) =======================
    // NOTE: there is no official USDT on any of these testnets. Tether has not
    // deployed one, so `stables` carries USDC alone. Claiming USDT here would
    // put a token in the UI that a payer cannot actually obtain.
    {
      key: "sepolia",
      name: "Ethereum Sepolia",
      chainId: 11155111,
      // publicnode answers, but timed out past 15s on a filtered getLogs over
      // 1500 blocks, so it is a genuine last resort here rather than a peer.
      rpcs: rpcList(alchemy("eth-sepolia"), "https://ethereum-sepolia-rpc.publicnode.com"),
      explorer: "https://sepolia.etherscan.io",
      nativeSymbol: "ETH",
      decimals: 18,
      testnet: true,
      enabled: true,
      faucet: "https://www.alchemy.com/faucets/ethereum-sepolia",
      // The L1 every other testnet here bridges FROM, so there is no "bridge
      // onto Sepolia" route to offer. Returning to it is done through the
      // destination chain's own bridge, in the withdraw direction.
      bridge: null,
      stables: [token("USDC", "USD Coin (test)", "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", 6)],
      wrappedNative: token("WETH", "Wrapped Ether", "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14", 18),
      // I assumed the canonical Uniswap V3 router and quoter were deployed here.
      // They are NOT — eth_getCode returns empty at both addresses on Sepolia.
      // Removed rather than corrected from memory: absent means paper only,
      // which is safe, whereas a second guess is still a guess.
      dex: null,
    },
    {
      key: "base-sepolia",
      name: "Base Sepolia",
      chainId: 84532,
      // Both public nodes verified: correct chainId, and an identical 5,137 logs
      // for the same filtered 1500-block query. Alchemy 403s for this key today.
      rpcs: rpcList(
        alchemy("base-sepolia"),
        "https://sepolia.base.org",
        "https://base-sepolia-rpc.publicnode.com"
      ),
      explorer: "https://sepolia.basescan.org",
      nativeSymbol: "ETH",
      decimals: 18,
      testnet: true,
      enabled: true,
      faucet: "https://www.alchemy.com/faucets/base-sepolia",
      bridge: bridge("Superbridge", "https://superbridge.app/base-sepolia"),
      stables: [token("USDC", "USD Coin (test)", "0x036CbD53842c5426634e7929541eC2318f3dCF7e", 6)],
      // 0x42...06 is the OP-stack WETH predeploy, identical across OP chains.
      wrappedNative: token("WETH", "Wrapped Ether", "0x4200000000000000000000000000000000000006", 18),
      /**
       * The ONLY enabled chain with working Uniswap V3, verified by real calls:
       * SwapRouter02 carries 24,497 bytes and QuoterV2 8,273 — the same sizes as
       * every verified mainnet deployment.
       *
       * Liquidity varies wildly BY FEE TIER here, which is why the quoter is
       * asked for all of them rather than one being assumed. Measured on
       * WETH -> USDC:
       *   0.3%  ~3,189 USDC/WETH, 0.9% impact at 0.01 WETH  <- realistic, usable
       *   0.05% ~531 USDC/WETH                              <- mispriced, 6x off
       *   1%    1,548 falling to 23, 98.5% impact           <- effectively empty
       * Quoting a single hardcoded tier would have picked a price 6x wrong.
       */
      dex: {
        type: "uniswap-v3",
        router: "0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4",
        quoter: "0xC5290058841028F1614F3A6F0F5816cAd0df5E27",
        feeTiers: [500, 3000, 10000],
      },
    },
    {
      key: "arbitrum-sepolia",
      name: "Arbitrum Sepolia",
      chainId: 421614,
      // Both verified, 42 logs each on the same filtered query.
      rpcs: rpcList(
        alchemy("arb-sepolia"),
        "https://sepolia-rollup.arbitrum.io/rpc",
        "https://arbitrum-sepolia-rpc.publicnode.com"
      ),
      explorer: "https://sepolia.arbiscan.io",
      nativeSymbol: "ETH",
      decimals: 18,
      testnet: true,
      enabled: true,
      faucet: "https://www.alchemy.com/faucets/arbitrum-sepolia",
      bridge: bridge("Arbitrum Bridge", "https://portal.arbitrum.io/bridge"),
      stables: [token("USDC", "USD Coin (test)", "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d", 6)],
      wrappedNative: token("WETH", "Wrapped Ether", "0x980B62Da83eFf3D4576C647993b0c1D7faf17c73", 18),
      dex: null,
    },
    {
      key: "optimism-sepolia",
      name: "Optimism Sepolia",
      chainId: 11155420,
      // Both verified, 152 logs each on the same filtered query.
      rpcs: rpcList(
        alchemy("opt-sepolia"),
        "https://sepolia.optimism.io",
        "https://optimism-sepolia-rpc.publicnode.com"
      ),
      explorer: "https://sepolia-optimism.etherscan.io",
      nativeSymbol: "ETH",
      decimals: 18,
      testnet: true,
      enabled: true,
      faucet: "https://www.alchemy.com/faucets/optimism-sepolia",
      bridge: bridge("Optimism Bridge", "https://app.optimism.io/bridge"),
      stables: [token("USDC", "USD Coin (test)", "0x5fd84259d66Cd46123540766Be93DFE6D43130D7", 6)],
      wrappedNative: token("WETH", "Wrapped Ether", "0x4200000000000000000000000000000000000006", 18),
      dex: null,
    },
    {
      key: "polygon-amoy",
      name: "Polygon Amoy",
      chainId: 80002,
      // rpc-amoy.polygon.technology is unreachable (verified: fetch fails
      // outright, not a rate limit). publicnode answers and confirms the USDC
      // contract below, so it is the fallback.
      // Only one verified public node. Amoy's documented endpoint
      // (rpc-amoy.polygon.technology) is dead — it is the source of the bare
      // "fetch failed" this work started from. Not listed rather than listed and
      // broken.
      rpcs: rpcList(alchemy("polygon-amoy"), "https://polygon-amoy-bor-rpc.publicnode.com"),
      explorer: "https://amoy.polygonscan.com",
      nativeSymbol: "POL",
      decimals: 18,
      testnet: true,
      enabled: true,
      faucet: "https://www.alchemy.com/faucets/polygon-amoy",
      bridge: bridge("Polygon Portal", "https://portal.polygon.technology"),
      stables: [token("USDC", "USD Coin (test)", "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582", 6)],
      wrappedNative: null, // no verified wrapped-native deployment on Amoy
      dex: null,
    },

    // ============ MAINNETS (disabled unless ENABLE_MAINNET=true) ============
    {
      key: "ethereum",
      name: "Ethereum",
      chainId: 1,
      // Mainnet endpoints are single-entry: they are disabled, so none of these
      // were put through the fallback verification the testnets got, and an
      // unverified real-money endpoint is worse than no fallback at all.
      rpcs: rpcList(alchemy("eth-mainnet"), "https://ethereum-rpc.publicnode.com"),
      explorer: "https://etherscan.io",
      nativeSymbol: "ETH",
      decimals: 18,
      testnet: false,
      enabled: mainnetEnabled,
      faucet: null,
      stables: [
        token("USDC", "USD Coin", "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", 6),
        token("USDT", "Tether USD", "0xdAC17F958D2ee523a2206206994597C13D831ec7", 6),
      ],
      wrappedNative: token("WETH", "Wrapped Ether", "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", 18),
      dex: UNIV3_CANONICAL,
    },
    {
      key: "base",
      name: "Base",
      chainId: 8453,
      rpcs: rpcList(alchemy("base-mainnet"), "https://mainnet.base.org"),
      explorer: "https://basescan.org",
      nativeSymbol: "ETH",
      decimals: 18,
      testnet: false,
      enabled: mainnetEnabled,
      faucet: null,
      stables: [
        token("USDC", "USD Coin", "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", 6),
        token("USDT", "Tether USD", "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2", 6),
      ],
      wrappedNative: token("WETH", "Wrapped Ether", "0x4200000000000000000000000000000000000006", 18),
      dex: {
        type: "uniswap-v3",
        router: "0x2626664c2603336E57B271c5C0b26F421741e481",
        quoter: "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a",
      },
    },
    {
      key: "arbitrum",
      name: "Arbitrum One",
      chainId: 42161,
      rpcs: rpcList(alchemy("arb-mainnet"), "https://arbitrum-one-rpc.publicnode.com"),
      explorer: "https://arbiscan.io",
      nativeSymbol: "ETH",
      decimals: 18,
      testnet: false,
      enabled: mainnetEnabled,
      faucet: null,
      stables: [
        token("USDC", "USD Coin", "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", 6),
        // The contract self-identifies as USD₮0, not USDT — Tether migrated
        // Arbitrum's USDT to its omnichain token. The address is right; the
        // label follows the chain rather than my assumption, so nobody thinks
        // they hold a different asset than they do.
        token("USD₮0", "Tether USD (omnichain)", "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", 6),
      ],
      wrappedNative: token("WETH", "Wrapped Ether", "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", 18),
      dex: UNIV3_CANONICAL,
    },
    {
      key: "optimism",
      name: "OP Mainnet",
      chainId: 10,
      rpcs: rpcList(alchemy("opt-mainnet"), "https://optimism-rpc.publicnode.com"),
      explorer: "https://optimistic.etherscan.io",
      nativeSymbol: "ETH",
      decimals: 18,
      testnet: false,
      enabled: mainnetEnabled,
      faucet: null,
      stables: [
        token("USDC", "USD Coin", "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", 6),
        token("USDT", "Tether USD", "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58", 6),
      ],
      wrappedNative: token("WETH", "Wrapped Ether", "0x4200000000000000000000000000000000000006", 18),
      dex: UNIV3_CANONICAL,
    },
    {
      key: "polygon",
      name: "Polygon",
      chainId: 137,
      rpcs: rpcList(alchemy("polygon-mainnet"), "https://polygon-bor-rpc.publicnode.com"),
      explorer: "https://polygonscan.com",
      nativeSymbol: "POL",
      decimals: 18,
      testnet: false,
      enabled: mainnetEnabled,
      faucet: null,
      stables: [
        token("USDC", "USD Coin", "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", 6),
        token("USDT", "Tether USD", "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", 6),
      ],
      wrappedNative: token("WPOL", "Wrapped POL", "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270", 18),
      dex: UNIV3_CANONICAL,
    },
    {
      key: "bnb",
      name: "BNB Chain",
      chainId: 56,
      rpcs: rpcList("https://bsc-rpc.publicnode.com"),
      explorer: "https://bscscan.com",
      nativeSymbol: "BNB",
      decimals: 18,
      testnet: false,
      enabled: mainnetEnabled,
      faucet: null,
      // BNB Chain stablecoins are 18 decimals, NOT 6. Assuming 6 here would
      // misread every balance by a factor of 10^12.
      stables: [
        token("USDT", "Tether USD", "0x55d398326f99059fF775485246999027B3197955", 18),
        token("USDC", "USD Coin", "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", 18),
      ],
      wrappedNative: token("WBNB", "Wrapped BNB", "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", 18),
      dex: null, // PancakeSwap, not Uniswap V3 — a different router interface
    },
    {
      key: "avalanche",
      name: "Avalanche C-Chain",
      chainId: 43114,
      rpcs: rpcList("https://avalanche-c-chain-rpc.publicnode.com"),
      explorer: "https://snowtrace.io",
      nativeSymbol: "AVAX",
      decimals: 18,
      testnet: false,
      enabled: mainnetEnabled,
      faucet: null,
      stables: [
        token("USDC", "USD Coin", "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", 6),
        token("USDT", "Tether USD", "0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7", 6),
      ],
      wrappedNative: token("WAVAX", "Wrapped AVAX", "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7", 18),
      dex: null, // Trader Joe, not Uniswap V3
    },
  ];
}

/**
 * Every chain's stablecoins plus its wrapped native, as one flat token list.
 * Kept as `tokens` because the wallet, the payment-address watcher and the
 * balance reader all already consume that shape.
 */
function tokensFor(chain) {
  return [...(chain.stables || []), ...(chain.wrappedNative ? [chain.wrappedNative] : [])];
}

// Chains exposed to the client — enabled only, and WITHOUT any RPC URL. BOTH
// `rpc` and `rpcs` are stripped: the list carries the same Alchemy key the single
// URL did, so exposing it would leak the key just as surely. The client talks to
// chains exclusively via the proxy.
function listChains() {
  return buildRegistry()
    .filter((c) => c.enabled)
    .map(({ rpc, rpcs, ...pub }) => ({
      ...pub,
      tokens: tokensFor(pub),
      hasKey: Boolean(process.env.ALCHEMY_API_KEY),
      // How many endpoints back this chain, so the UI can say "1 of 3 tried"
      // without ever seeing a URL.
      endpointCount: rpcs.length,
    }));
}

// Full chain record (incl. rpc) for server-side proxying. Returns null if the chain
// is unknown or disabled — so a disabled mainnet can never be proxied.
function getChain(chainId) {
  const id = Number(chainId);
  const chain = buildRegistry().find((c) => c.chainId === id && c.enabled) || null;
  return chain ? { ...chain, tokens: tokensFor(chain) } : null;
}

/** Every chain including disabled ones. For config verification only. */
function allChains() {
  return buildRegistry();
}

module.exports = { listChains, getChain, allChains, tokensFor };
