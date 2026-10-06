/**
 * UNIVERSAL TOKEN RESOLUTION — a coin index proposes, the chain disposes.
 *
 * Live trading used to be limited to the dozen assets `chains.js` carries by
 * hand, because `tradeability.js` matched a watched coin against the registry by
 * SYMBOL. Every other coin — which is to say almost every coin anyone searches
 * for — came back "paper only", and the message blamed the chain for a limit
 * that was ours.
 *
 * The resolver lifts that by taking a contract address from a named source and
 * then reading `symbol()`, `name()` and `decimals()` off the chain before the
 * address is allowed anywhere near a swap. These tests guard the refusals,
 * because a resolver that says yes when it should say no is how real money
 * reaches a contract nobody controls.
 *
 * THE ONE THAT MATTERS MOST is the decimals disagreement. Amounts are computed
 * from decimals; an address that is stale, or right for a different token,
 * usually differs there first, and trading on the wrong number moves a thousand
 * times what the user typed or a thousandth of it.
 *
 * Both upstreams are mocked at the module-object seam. The app is CommonJS and
 * loads through Node's own `require`, which sits outside vitest's module
 * mocking, so `vi.mock` would be ignored; the properties are swapped here and
 * put back afterwards, exactly as LW-025 does.
 */

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

// Base Sepolia is used because it is enabled with no environment at all, so
// these tests never depend on ENABLE_MAINNET.
const CHAIN_ID = 84532;

// ERC-20 selectors, as the service calls them.
const SEL_SYMBOL = "0x95d89b41";
const SEL_NAME = "0x06fdde03";
const SEL_DECIMALS = "0x313ce567";

/** ABI-encode a dynamic string the way a real ERC-20 returns one. */
function abiString(text) {
  const bytes = Buffer.from(text, "utf8");
  const len = bytes.length.toString(16).padStart(64, "0");
  const body = bytes.toString("hex").padEnd(Math.ceil(bytes.length / 32) * 64, "0");
  return "0x" + (32).toString(16).padStart(64, "0") + len + body;
}

function abiUint(n) {
  return "0x" + n.toString(16).padStart(64, "0");
}

/** A contract that answers with this symbol/name/decimals, and nothing else. */
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
    // The chain calls it FOO-Bridged. That label wins: it is what the contract
    // actually reports, and the index only ever agreed that the address is right.
    contractAnswers({ symbol: "FOO-Bridged", name: "Foo Bridged", decimals: 18 });

    const r = await resolveCoinOnChain({ coinId: "foo-token", chainId: CHAIN_ID });

    expect(r.ok).toBe(true);
    expect(r.source).toBe("coingecko-verified");
    expect(r.token).toMatchObject({ symbol: "FOO-Bridged", decimals: 18, address: TOKEN_ADDRESS });
    // A symbol that disagrees is normal for bridged assets: reported, not fatal.
    expect(r.warnings.join(" ")).toMatch(/FOO-Bridged/);
  });

  it("REFUSES when the index and the contract disagree on decimals", async () => {
    // The index says 6, the contract says 18. One of them is about a different
    // token. Picking either would move the wrong amount by a factor of 10^12.
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
    // An address with no code answers every call with 0x, which is exactly this.
    rpcCall.mockImplementation(async () => "0x");

    const r = await resolveCoinOnChain({ coinId: "foo-token", chainId: CHAIN_ID });

    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/does not report a symbol and decimals/i);
  });

  it("says the CHAIN could not be reached, rather than that the token is bad", async () => {
    coinSays();
    rpcCall.mockResolvedValue(null); // transport failure on every call

    const r = await resolveCoinOnChain({ coinId: "foo-token", chainId: CHAIN_ID });

    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/could not be reached/i);
    expect(r.reason).toMatch(/Nothing was assumed/i);
  });

  it("prefers the registry, matched by ADDRESS rather than by symbol", async () => {
    // Any token may call itself USDC. Matching on the symbol is how the wrong
    // contract gets picked; matching on the address cannot make that mistake.
    const chain = getChain(CHAIN_ID);
    const known = (chain.tokens || [])[0];
    expect(known).toBeTruthy();
    coinSays({ symbol: known.symbol, decimals: known.decimals, address: known.address });

    const r = await resolveCoinOnChain({ coinId: "foo-token", chainId: CHAIN_ID });

    expect(r.ok).toBe(true);
    expect(r.source).toBe("registry");
    expect(r.token.address).toBe(known.address);
    // Verified already, so the chain was never asked.
    expect(rpcCall).not.toHaveBeenCalled();
  });

  it("maps the chain's own coin to its wrapped native without asking the chain", async () => {
    // "Buy ETH on this network" means the wrapped native: an exchange cannot
    // hand back a native coin. Driven by the index's native_coin_id, so there
    // is no hand-written table of synonyms to drift.
    const r = await resolveCoinOnChain({ coinId: "ethereum", chainId: CHAIN_ID });

    expect(r.ok).toBe(true);
    expect(r.source).toBe("registry-wrapped-native");
    expect(r.token.symbol).toBe(getChain(CHAIN_ID).wrappedNative.symbol);
    expect(rpcCall).not.toHaveBeenCalled();
  });

  it("refuses a non-Ethereum-style address instead of passing it downstream", async () => {
    // A Solana mint is base58 and 32 bytes. This resolver is EVM-only and must
    // say so rather than handing something unusable to the swap path.
    coinSays({ address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" });

    const r = await resolveCoinOnChain({ coinId: "foo-token", chainId: CHAIN_ID });

    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/not an Ethereum-style address/i);
  });

  it("says an outage is an outage when the chain index itself is unavailable", async () => {
    // The map comes back EMPTY when it has never been read. Reporting that as
    // "this network is not listed" would blame the chain, permanently-sounding,
    // for a rate limit that clears in a minute.
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
    // Must NOT invite a retry: this one will never succeed.
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

    // A refusal is remembered far more briefly than a success, so one bad
    // minute on an endpoint cannot make a coin untradeable for the afternoon.
    const { RESOLVE_TTL, REFUSAL_TTL } = require("../services/tokenResolver.service");
    expect(REFUSAL_TTL).toBeLessThan(RESOLVE_TTL / 60);
  });
});
