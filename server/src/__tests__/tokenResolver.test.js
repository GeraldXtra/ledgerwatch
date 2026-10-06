process.env.SMTP_HOST = "";
process.env.VAPID_PRIVATE_KEY = "";

const rpcService = require("../services/rpc.service");
const cg = require("../services/coingecko.service");
const { getChain } = require("../config/chains");
const { resolveCoinOnChain, _clearCache } = require("../services/tokenResolver.service");

const realRpcCall = rpcService.rpcCall;
const realPlatforms = cg.getAssetPlatforms;
const realCoinPlatforms = cg.getCoinPlatforms;

const rpcCall = vi.fn();

const CHAIN_ID = 84532;

const SEL_SYMBOL = "0x95d89b41";
const SEL_NAME = "0x06fdde03";
const SEL_DECIMALS = "0x313ce567";

function abiString(text) {
  const bytes = Buffer.from(text, "utf8");
  const len = bytes.length.toString(16).padStart(64, "0");
  const body = bytes.toString("hex").padEnd(Math.ceil(bytes.length / 32) * 64, "0");
  return "0x" + (32).toString(16).padStart(64, "0") + len + body;
}

function abiUint(n) {
  return "0x" + n.toString(16).padStart(64, "0");
}

function contractAnswers({ symbol, name, decimals }) {
  rpcCall.mockImplementation(async (chain, method, params) => {
    if (method !== "eth_call") return null;
    const data = params[0].data;
    if (data === SEL_SYMBOL) return symbol === null ? "0x" : abiString(symbol);
    if (data === SEL_NAME) return name === null ? "0x" : abiString(name);
    if (data === SEL_DECIMALS) return decimals === null ? "0x" : abiUint(decimals);
    return null;
  });
}

const PLATFORMS = {
  platforms: {
    "base-sepolia": { id: "base-sepolia", chainId: CHAIN_ID, name: "Base Sepolia", nativeCoinId: "ethereum" },
  },
  byChainId: { [CHAIN_ID]: "base-sepolia" },
  stale: false,
  available: true,
};

const TOKEN_ADDRESS = "0x1111111111111111111111111111111111111111";

function coinSays({ symbol = "FOO", decimals = 18, address = TOKEN_ADDRESS } = {}) {
  cg.getCoinPlatforms = async () => ({
    coinId: "foo-token",
    symbol,
    name: "Foo Token",
    platforms: { "base-sepolia": { address, decimals } },
    stale: false,
  });
}

beforeAll(() => {
  rpcService.rpcCall = rpcCall;
});

afterAll(() => {
  rpcService.rpcCall = realRpcCall;
  cg.getAssetPlatforms = realPlatforms;
  cg.getCoinPlatforms = realCoinPlatforms;
});

beforeEach(() => {
  _clearCache();
  rpcCall.mockReset();
  cg.getAssetPlatforms = async () => PLATFORMS;
  cg.getCoinPlatforms = realCoinPlatforms;
});

describe("resolving a coin to a contract", () => {
  it("accepts a contract whose decimals agree with the index, and uses the CHAIN's answers", async () => {
    coinSays({ symbol: "FOO", decimals: 18 });
    contractAnswers({ symbol: "FOO-Bridged", name: "Foo Bridged", decimals: 18 });

    const r = await resolveCoinOnChain({ coinId: "foo-token", chainId: CHAIN_ID });

    expect(r.ok).toBe(true);
    expect(r.source).toBe("coingecko-verified");
    expect(r.token).toMatchObject({ symbol: "FOO-Bridged", decimals: 18, address: TOKEN_ADDRESS });
    expect(r.warnings.join(" ")).toMatch(/FOO-Bridged/);
  });

  it("REFUSES when the index and the contract disagree on decimals", async () => {
    coinSays({ symbol: "FOO", decimals: 6 });
    contractAnswers({ symbol: "FOO", name: "Foo", decimals: 18 });

    const r = await resolveCoinOnChain({ coinId: "foo-token", chainId: CHAIN_ID });

    expect(r.ok).toBe(false);
    expect(r.token).toBeNull();
    expect(r.reason).toMatch(/6 decimals/);
    expect(r.reason).toMatch(/reports 18/);
  });

  it("refuses a contract that does not report a symbol and decimals", async () => {
    coinSays();
    contractAnswers({ symbol: null, name: null, decimals: null });
    rpcCall.mockImplementation(async () => "0x");

    const r = await resolveCoinOnChain({ coinId: "foo-token", chainId: CHAIN_ID });

    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/does not report a symbol and decimals/i);
  });

  it("says the CHAIN could not be reached, rather than that the token is bad", async () => {
    coinSays();
    rpcCall.mockResolvedValue(null);

    const r = await resolveCoinOnChain({ coinId: "foo-token", chainId: CHAIN_ID });

    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/could not be reached/i);
    expect(r.reason).toMatch(/Nothing was assumed/i);
  });

  it("prefers the registry, matched by ADDRESS rather than by symbol", async () => {
    const chain = getChain(CHAIN_ID);
    const known = (chain.tokens || [])[0];
    expect(known).toBeTruthy();
    coinSays({ symbol: known.symbol, decimals: known.decimals, address: known.address });

    const r = await resolveCoinOnChain({ coinId: "foo-token", chainId: CHAIN_ID });

    expect(r.ok).toBe(true);
    expect(r.source).toBe("registry");
    expect(r.token.address).toBe(known.address);
    expect(rpcCall).not.toHaveBeenCalled();
  });

  it("maps the chain's own coin to its wrapped native without asking the chain", async () => {
    const r = await resolveCoinOnChain({ coinId: "ethereum", chainId: CHAIN_ID });

    expect(r.ok).toBe(true);
    expect(r.source).toBe("registry-wrapped-native");
    expect(r.token.symbol).toBe(getChain(CHAIN_ID).wrappedNative.symbol);
    expect(rpcCall).not.toHaveBeenCalled();
  });

  it("refuses a non-Ethereum-style address instead of passing it downstream", async () => {
    coinSays({ address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" });

    const r = await resolveCoinOnChain({ coinId: "foo-token", chainId: CHAIN_ID });

    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/not an Ethereum-style address/i);
  });

  it("says an outage is an outage when the chain index itself is unavailable", async () => {
    cg.getAssetPlatforms = async () => ({ platforms: {}, byChainId: {}, stale: true, available: false });

    const r = await resolveCoinOnChain({ coinId: "foo-token", chainId: CHAIN_ID });

    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/could not be reached/i);
    expect(r.reason).not.toMatch(/does not list/i);
  });

  it("tells a coin that does not exist apart from an index that cannot be asked", async () => {
    cg.getCoinPlatforms = async () => ({ notFound: true });

    const r = await resolveCoinOnChain({ coinId: "no-such-coin", chainId: CHAIN_ID });

    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/no record of/i);
    expect(r.reason).not.toMatch(/try again/i);
  });

  it("refuses a chain that is unknown or disabled", async () => {
    const r = await resolveCoinOnChain({ coinId: "foo-token", chainId: 999999 });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/not available/i);
  });

  it("caches a success, and does NOT latch a refusal for long", async () => {
    coinSays({ symbol: "FOO", decimals: 18 });
    contractAnswers({ symbol: "FOO", name: "Foo", decimals: 18 });

    await resolveCoinOnChain({ coinId: "foo-token", chainId: CHAIN_ID });
    const callsAfterFirst = rpcCall.mock.calls.length;
    await resolveCoinOnChain({ coinId: "foo-token", chainId: CHAIN_ID });
    expect(rpcCall.mock.calls.length).toBe(callsAfterFirst);

    const { RESOLVE_TTL, REFUSAL_TTL } = require("../services/tokenResolver.service");
    expect(REFUSAL_TTL).toBeLessThan(RESOLVE_TTL / 60);
  });
});
