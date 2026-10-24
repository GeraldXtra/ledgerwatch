function alchemy(subdomain) {
  const key = process.env.ALCHEMY_API_KEY;
  return key ? `https://${subdomain}.g.alchemy.com/v2/${key}` : null;
}

function rpcList(...urls) {
  return urls.filter(Boolean);
}

const token = (symbol, name, address, decimals) => ({ symbol, name, address, decimals });

const bridge = (name, url) => ({ name, url });

const UNIV3_CANONICAL = {
  type: "uniswap-v3",
  router: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
  quoter: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
  feeTiers: [100, 500, 3000, 10000],
};

function buildRegistry() {
  const mainnetEnabled = process.env.ENABLE_MAINNET === "true";

  return rawRegistry(mainnetEnabled).map((c) => ({ ...c, rpc: c.rpcs[0] }));
}

function rawRegistry(mainnetEnabled) {
  return [
    {
      key: "sepolia",
      name: "Ethereum Sepolia",
      chainId: 11155111,
      rpcs: rpcList("https://ethereum-sepolia-rpc.publicnode.com", alchemy("eth-sepolia")),
      explorer: "https://sepolia.etherscan.io",
      nativeSymbol: "ETH",
      decimals: 18,
      logSpan: 1500,
      testnet: true,
      enabled: true,
      faucet: "https://www.alchemy.com/faucets/ethereum-sepolia",
      bridge: null,
      stables: [token("USDC", "USD Coin (test)", "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", 6)],
      wrappedNative: token("WETH", "Wrapped Ether", "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14", 18),
      dex: null,
    },
    {
      key: "base-sepolia",
      name: "Base Sepolia",
      chainId: 84532,
      rpcs: rpcList(
        "https://sepolia.base.org",
        "https://base-sepolia-rpc.publicnode.com",
        alchemy("base-sepolia")
      ),
      explorer: "https://sepolia.basescan.org",
      nativeSymbol: "ETH",
      decimals: 18,
      logSpan: 1500,
      testnet: true,
      enabled: true,
      faucet: "https://www.alchemy.com/faucets/base-sepolia",
      bridge: bridge("Superbridge", "https://superbridge.app/base-sepolia"),
      stables: [token("USDC", "USD Coin (test)", "0x036CbD53842c5426634e7929541eC2318f3dCF7e", 6)],
      wrappedNative: token("WETH", "Wrapped Ether", "0x4200000000000000000000000000000000000006", 18),
      dex: {
        type: "uniswap-v3",
        router: "0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4",
        quoter: "0xC5290058841028F1614F3A6F0F5816cAd0df5E27",
        feeTiers: [100, 500, 3000, 10000],
      },
    },
    {
      key: "arbitrum-sepolia",
      name: "Arbitrum Sepolia",
      chainId: 421614,
      rpcs: rpcList(
        "https://sepolia-rollup.arbitrum.io/rpc",
        "https://arbitrum-sepolia-rpc.publicnode.com",
        alchemy("arb-sepolia")
      ),
      explorer: "https://sepolia.arbiscan.io",
      nativeSymbol: "ETH",
      decimals: 18,
      logSpan: 1500,
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
      rpcs: rpcList(
        "https://sepolia.optimism.io",
        "https://optimism-sepolia-rpc.publicnode.com",
        alchemy("opt-sepolia")
      ),
      explorer: "https://sepolia-optimism.etherscan.io",
      nativeSymbol: "ETH",
      decimals: 18,
      logSpan: 1500,
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
      rpcs: rpcList("https://polygon-amoy-bor-rpc.publicnode.com", alchemy("polygon-amoy")),
      explorer: "https://amoy.polygonscan.com",
      nativeSymbol: "POL",
      decimals: 18,
      logSpan: 1500,
      testnet: true,
      enabled: true,
      faucet: "https://www.alchemy.com/faucets/polygon-amoy",
      bridge: bridge("Polygon Portal", "https://portal.polygon.technology"),
      stables: [token("USDC", "USD Coin (test)", "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582", 6)],
      wrappedNative: null,
      dex: null,
    },

    {
      key: "ethereum",
      name: "Ethereum",
      chainId: 1,
      rpcs: rpcList(
        "https://rpc.mevblocker.io",
        "https://eth.drpc.org",
        alchemy("eth-mainnet")
      ),
      logSpan: 2000,
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
      assets: [
        token("WBTC", "Wrapped BTC", "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", 8),
        token("LINK", "ChainLink Token", "0x514910771AF9Ca656af840dff83E8264EcF986CA", 18),
        token("UNI", "Uniswap", "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984", 18),
        token("AAVE", "Aave Token", "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9", 18),
      ],
      dex: UNIV3_CANONICAL,
    },
    {
      key: "base",
      name: "Base",
      chainId: 8453,
      rpcs: rpcList("https://mainnet.base.org", "https://base.drpc.org"),
      logSpan: 2000,
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
      assets: [
        token("cbBTC", "Coinbase Wrapped BTC", "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", 8),
      ],
      dex: {
        type: "uniswap-v3",
        router: "0x2626664c2603336E57B271c5C0b26F421741e481",
        feeTiers: [100, 500, 3000, 10000],
        quoter: "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a",
      },
    },
    {
      key: "arbitrum",
      name: "Arbitrum One",
      chainId: 42161,
      rpcs: rpcList("https://arb1.arbitrum.io/rpc", "https://arbitrum.gateway.tenderly.co"),
      logSpan: 2000,
      explorer: "https://arbiscan.io",
      nativeSymbol: "ETH",
      decimals: 18,
      testnet: false,
      enabled: mainnetEnabled,
      faucet: null,
      stables: [
        token("USDC", "USD Coin", "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", 6),
        token("USD₮0", "Tether USD (omnichain)", "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", 6),
      ],
      wrappedNative: token("WETH", "Wrapped Ether", "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", 18),
      assets: [
        token("WBTC", "Wrapped BTC", "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f", 8),
        token("ARB", "Arbitrum", "0x912CE59144191C1204E64559FE8253a0e49E6548", 18),
        token("LINK", "ChainLink Token", "0xf97f4df75117a78c1A5a0DBb814Af92458539FB4", 18),
      ],
      dex: UNIV3_CANONICAL,
    },
    {
      key: "optimism",
      name: "OP Mainnet",
      chainId: 10,
      rpcs: rpcList("https://mainnet.optimism.io", "https://optimism.drpc.org"),
      logSpan: 2000,
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
      assets: [
        token("WBTC", "Wrapped BTC", "0x68f180fcCe6836688e9084f035309E29Bf0A2095", 8),
        token("OP", "Optimism", "0x4200000000000000000000000000000000000042", 18),
      ],
      dex: UNIV3_CANONICAL,
    },
    {
      key: "polygon",
      name: "Polygon",
      chainId: 137,
      rpcs: rpcList(
        "https://polygon-bor-rpc.publicnode.com",
        "https://rpc-mainnet.matic.quiknode.pro",
        "https://polygon.gateway.tenderly.co"
      ),
      logSpan: 2000,
      explorer: "https://polygonscan.com",
      nativeSymbol: "POL",
      decimals: 18,
      testnet: false,
      enabled: mainnetEnabled,
      faucet: null,
      stables: [
        token("USDC", "USD Coin", "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", 6),
        token("USDT0", "Tether USD (omnichain)", "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", 6),
      ],
      wrappedNative: token("WPOL", "Wrapped POL", "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270", 18),
      assets: [
        token("WBTC", "(PoS) Wrapped BTC", "0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6", 8),
        token("WETH", "Wrapped Ether", "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619", 18),
        token("LINK", "ChainLink Token", "0x53E0bca35eC356BD5ddDFebbD1Fc0fD03FaBad39", 18),
      ],
      dex: UNIV3_CANONICAL,
    },
    {
      key: "bnb",
      name: "BNB Chain",
      chainId: 56,
      rpcs: rpcList("https://bsc-rpc.publicnode.com", "https://bsc-dataseed.binance.org"),
      logSpan: 2000,
      explorer: "https://bscscan.com",
      nativeSymbol: "BNB",
      decimals: 18,
      testnet: false,
      enabled: mainnetEnabled,
      faucet: null,
      stables: [
        token("USDT", "Tether USD", "0x55d398326f99059fF775485246999027B3197955", 18),
        token("USDC", "USD Coin", "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", 18),
      ],
      wrappedNative: token("WBNB", "Wrapped BNB", "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", 18),
      assets: [
        token("BTCB", "BTCB Token", "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c", 18),
        token("ETH", "Ethereum Token", "0x2170Ed0880ac9A755fd29B2688956BD959F933F8", 18),
        token("Cake", "PancakeSwap Token", "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82", 18),
      ],
      dex: {
        type: "uniswap-v3",
        router: "0xB971eF87ede563556b2ED4b1C0b0019111Dd85d2",
        quoter: "0x78D78E420Da98ad378D7799bE8f4AF69033EB077",
        feeTiers: [100, 500, 3000, 10000],
      },
    },
    {
      key: "avalanche",
      name: "Avalanche C-Chain",
      chainId: 43114,
      rpcs: rpcList(
        "https://avalanche-c-chain-rpc.publicnode.com",
        "https://avalanche.drpc.org",
        "https://api.avax.network/ext/bc/C/rpc"
      ),
      logSpan: 2000,
      explorer: "https://snowtrace.io",
      nativeSymbol: "AVAX",
      decimals: 18,
      testnet: false,
      enabled: mainnetEnabled,
      faucet: null,
      stables: [
        token("USDC", "USD Coin", "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", 6),
        token("USDt", "Tether USD", "0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7", 6),
      ],
      wrappedNative: token("WAVAX", "Wrapped AVAX", "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7", 18),
      assets: [
        token("BTC.b", "Bitcoin", "0x152b9d0FdC40C096757F570A51E494bd4b943E50", 8),
        token("WETH.e", "Wrapped Ether", "0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB", 18),
      ],
      dex: {
        type: "uniswap-v3",
        router: "0xbb00FF08d01D300023C629E8fFfFcb65A5a578cE",
        quoter: "0xbe0F5544EC67e9B3b2D979aaA43f18Fd87E6257F",
        feeTiers: [100, 500, 3000, 10000],
      },
    },
  ];
}

function tokensFor(chain) {
  return [
    ...(chain.stables || []),
    ...(chain.wrappedNative ? [chain.wrappedNative] : []),
    ...(chain.assets || []),
  ];
}

function listChains() {
  return buildRegistry()
    .filter((c) => c.enabled)
    .map(({ rpc, rpcs, ...pub }) => ({
      ...pub,
      tokens: tokensFor(pub),
      hasKey: Boolean(process.env.ALCHEMY_API_KEY),
      endpointCount: rpcs.length,
    }));
}

function getChain(chainId) {
  const id = Number(chainId);
  const chain = buildRegistry().find((c) => c.chainId === id && c.enabled) || null;
  return chain ? { ...chain, tokens: tokensFor(chain) } : null;
}

function allChains() {
  return buildRegistry();
}

module.exports = { listChains, getChain, allChains, tokensFor };
