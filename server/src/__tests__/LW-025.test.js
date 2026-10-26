process.env.SMTP_HOST = "";
process.env.VAPID_PRIVATE_KEY = "";

const rpcService = require("../services/rpc.service");
const realRpcCall = rpcService.rpcCall;
const realRpcCallTyped = rpcService.rpcCallTyped;
const rpcCall = vi.fn();
beforeAll(() => {
  rpcService.rpcCall = rpcCall;
  rpcService.rpcCallTyped = async (chain, method, params) => {
    const r = await rpcCall(chain, method, params);
    if (r && r.__rpcError) return { ok: false, reason: `rpc error: ${r.__rpcError}` };
    if (r === null) return { ok: false, reason: "all 1 endpoint(s) failed: mock" };
    return { ok: true, result: r };
  };
});
afterAll(() => {
  rpcService.rpcCall = realRpcCall;
  rpcService.rpcCallTyped = realRpcCallTyped;
});

const User = require("../models/User");
const WalletTx = require("../models/WalletTx");
const { getChain } = require("../config/chains");
const {
  syncInboundTransfers,
  decodeAbiString,
  sanitizeText,
  spanFor,
  _resetDiscoveryForTests,
} = require("../services/walletHistory.service");

beforeEach(() => _resetDiscoveryForTests());

const CHAIN_ID = 84532;
const WALLET = "0x1111111111111111111111111111111111111111";
const SENDER = "0x2222222222222222222222222222222222222222";
const SPAM = "0xabababababababababababababababababababab";
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const pad = (addr) => "0x" + addr.toLowerCase().slice(2).padStart(64, "0");
const word = (n) => BigInt(n).toString(16).padStart(64, "0");

function abiString(s) {
  const hex = Buffer.from(s, "utf8").toString("hex");
  const padded = hex.padEnd(Math.ceil(Math.max(hex.length, 1) / 64) * 64, "0");
  return "0x" + word(32) + word(hex.length / 2) + padded;
}

function transferLog({ contract, to = WALLET, from = SENDER, amount, block, hash }) {
  return {
    address: contract,
    topics: [TRANSFER, pad(from), pad(to)],
    data: "0x" + word(amount),
    blockNumber: "0x" + block.toString(16),
    transactionHash: hash,
    removed: false,
  };
}

function fakeChain({ head, logs = [], meta = {}, failWindows = [], refuseUnfiltered = false }) {
  const calls = [];
  rpcCall.mockReset();
  rpcCall.mockImplementation(async (chain, method, params) => {
    if (method === "eth_blockNumber") return "0x" + head.toString(16);
    if (method === "eth_getLogs") {
      const from = parseInt(params[0].fromBlock, 16);
      const to = parseInt(params[0].toBlock, 16);
      const addresses = Array.isArray(params[0].address)
        ? params[0].address.map((a) => String(a).toLowerCase())
        : null;
      calls.push(addresses ? { from, to, address: true } : { from, to });
      if (failWindows.some((f) => f.from === from)) return null;
      if (refuseUnfiltered && !addresses) {
        return { __rpcError: "Please specify an address in your request or, to remove restrictions, order a dedicated full node here" };
      }
      return logs.filter((l) => {
        const b = parseInt(l.blockNumber, 16);
        if (addresses && !addresses.includes(String(l.address).toLowerCase())) return false;
        return b >= from && b <= to;
      });
    }
    if (method === "eth_call") {
      const to = String(params[0].to).toLowerCase();
      const m = meta[to];
      if (!m) return null;
      const sel = params[0].data;
      if (sel === "0x95d89b41") return m.symbol == null ? null : abiString(m.symbol);
      if (sel === "0x06fdde03") return m.name == null ? null : abiString(m.name);
      if (sel === "0x313ce567") return m.decimals == null ? null : "0x" + word(m.decimals);
    }
    return null;
  });
  return calls;
}

async function makeUser(extra = {}) {
  return User.create({
    name: "Owner",
    email: `owner-${Date.now()}-${Math.random()}@example.com`,
    passwordHash: "x",
    walletAddress: WALLET,
    ...extra,
  });
}

const cursorOf = async (userId) => {
  const u = await User.findById(userId).lean();
  const c = (u.walletHistoryCursors || []).find((x) => x.chainId === CHAIN_ID);
  return c ? c.block : null;
};

describe("LW-025: the cursor only covers blocks that were actually read", () => {
  it("holds the cursor at the last successful window when a later one fails", async () => {
    const chain = getChain(CHAIN_ID);
    const span = spanFor(chain);
    const head = 10_000;
    const user = await makeUser({ walletHistoryCursors: [{ chainId: CHAIN_ID, block: 1_000 }] });

    const firstFrom = 950;
    const secondFrom = firstFrom + span;
    const calls = fakeChain({ head, failWindows: [{ from: secondFrom }] });

    const r = await syncInboundTransfers({ userId: user._id, chainId: CHAIN_ID, address: WALLET });

    expect(r.failed).toBe(true);
    expect(calls[0]).toEqual({ from: firstFrom, to: firstFrom + span - 1 });
    expect(calls).toHaveLength(2);
    expect(await cursorOf(user._id)).toBe(firstFrom + span - 1);
  });

  it("does not commit a first-time lookback that failed", async () => {
    const user = await makeUser();
    fakeChain({ head: 10_000, failWindows: [{ from: 10_000 - spanFor(getChain(CHAIN_ID)) + 1 }] });

    const r = await syncInboundTransfers({ userId: user._id, chainId: CHAIN_ID, address: WALLET });

    expect(r.failed).toBe(true);
    expect(await cursorOf(user._id)).toBeNull();
  });

  it("catches a long gap up over successive loads instead of skipping it", async () => {
    const chain = getChain(CHAIN_ID);
    const span = spanFor(chain);
    const head = 100_000;
    const user = await makeUser({ walletHistoryCursors: [{ chainId: CHAIN_ID, block: 1_000 }] });

    const calls = fakeChain({ head });
    await syncInboundTransfers({ userId: user._id, chainId: CHAIN_ID, address: WALLET });

    const after = await cursorOf(user._id);
    expect(calls[0].from).toBe(950);
    expect(after).toBe(calls[calls.length - 1].to);
    expect(after).toBeLessThan(head);
    expect(after).toBeGreaterThan(1_000 + span);

    const calls2 = fakeChain({ head });
    await syncInboundTransfers({ userId: user._id, chainId: CHAIN_ID, address: WALLET });
    expect(calls2[0].from).toBe(after - 50);
    expect(await cursorOf(user._id)).toBeGreaterThan(after);
  });
});

describe("new token detection", () => {
  it("records a registry token transfer as history and does not 'discover' it", async () => {
    const chain = getChain(CHAIN_ID);
    const usdc = chain.tokens.find((t) => t.symbol === "USDC");
    const user = await makeUser();
    const head = 5_000;
    fakeChain({
      head,
      logs: [
        transferLog({
          contract: usdc.address.toLowerCase(),
          amount: 2_500_000,
          block: head - 10,
          hash: "0x" + "11".repeat(32),
        }),
      ],
    });

    const r = await syncInboundTransfers({ userId: user._id, chainId: CHAIN_ID, address: WALLET });

    expect(r.added).toBe(1);
    expect(r.discovered).toBe(0);
    const tx = await WalletTx.findOne({ userId: user._id });
    expect(tx.symbol).toBe("USDC");
    expect(tx.value).toBe("2.5");
    expect(tx.direction).toBe("in");
    const u = await User.findById(user._id).lean();
    expect(u.discoveredTokens).toHaveLength(0);
  });

  it("discovers an unknown token with metadata read from its contract, and does not add it", async () => {
    const user = await makeUser();
    const head = 5_000;
    fakeChain({
      head,
      logs: [
        transferLog({
          contract: SPAM,
          amount: 1_500_000_000_000_000_000n,
          block: head - 3,
          hash: "0x" + "22".repeat(32),
        }),
      ],
      meta: { [SPAM]: { symbol: "SPAM", name: "Spam Token", decimals: 18 } },
    });

    const r = await syncInboundTransfers({ userId: user._id, chainId: CHAIN_ID, address: WALLET });

    expect(r.discovered).toBe(1);
    const u = await User.findById(user._id).lean();
    expect(u.discoveredTokens).toHaveLength(1);
    const d = u.discoveredTokens[0];
    expect(d).toMatchObject({
      chainId: CHAIN_ID,
      address: SPAM,
      symbol: "SPAM",
      name: "Spam Token",
      decimals: 18,
      readable: true,
      status: "new",
      firstAmount: "1.5",
      firstSeenBlock: head - 3,
      impersonates: null,
    });
    expect(d.firstFrom).toBe(SENDER);
    expect(u.customTokens).toHaveLength(0);
    const tx = await WalletTx.findOne({ userId: user._id, tokenAddress: SPAM });
    expect(tx.symbol).toBe("SPAM");
    expect(tx.value).toBe("1.5");
  });

  it("flags a contract whose symbol copies a verified token on the chain", async () => {
    const user = await makeUser();
    const head = 5_000;
    fakeChain({
      head,
      logs: [transferLog({ contract: SPAM, amount: 1, block: head - 1, hash: "0x" + "33".repeat(32) })],
      meta: { [SPAM]: { symbol: "USDC", name: "USD Coin", decimals: 6 } },
    });

    await syncInboundTransfers({ userId: user._id, chainId: CHAIN_ID, address: WALLET });

    const u = await User.findById(user._id).lean();
    expect(u.discoveredTokens[0].impersonates).toBe("USDC");
  });

  it("does not latch a contract that failed to answer; it is read on a later sync", async () => {
    const user = await makeUser();
    const head = 5_000;
    fakeChain({
      head,
      logs: [transferLog({ contract: SPAM, amount: 7, block: head - 1, hash: "0x" + "44".repeat(32) })],
      meta: {},
    });
    await syncInboundTransfers({ userId: user._id, chainId: CHAIN_ID, address: WALLET });

    let u = await User.findById(user._id).lean();
    expect(u.discoveredTokens).toHaveLength(1);
    expect(u.discoveredTokens[0].readable).toBe(false);
    expect(u.discoveredTokens[0].lookupAttempts).toBe(0);

    fakeChain({ head: head + 10, meta: { [SPAM]: { symbol: "LATE", name: "Late", decimals: 8 } } });
    await syncInboundTransfers({ userId: user._id, chainId: CHAIN_ID, address: WALLET });

    u = await User.findById(user._id).lean();
    expect(u.discoveredTokens).toHaveLength(1);
    expect(u.discoveredTokens[0]).toMatchObject({ symbol: "LATE", decimals: 8, readable: true });
  });

  it("ignores ERC-721 transfers, which share the event signature", async () => {
    const user = await makeUser();
    const head = 5_000;
    const nft = transferLog({ contract: SPAM, amount: 1, block: head - 1, hash: "0x" + "55".repeat(32) });
    nft.topics.push(word(42));
    fakeChain({ head, logs: [nft], meta: { [SPAM]: { symbol: "NFT", name: "Pic", decimals: 0 } } });

    const r = await syncInboundTransfers({ userId: user._id, chainId: CHAIN_ID, address: WALLET });

    expect(r.discovered).toBe(0);
    expect(r.added).toBe(0);
  });

  it("reads the known tokens through an address filter when the node refuses unfiltered queries (LW-084)", async () => {
    const chain = getChain(CHAIN_ID);
    const known = chain.tokens[0];
    const user = await makeUser();
    const head = 1000;
    const calls = fakeChain({
      head,
      refuseUnfiltered: true,
      logs: [
        transferLog({ contract: known.address, amount: 5_000_000, block: head - 3, hash: "0x" + "a1".repeat(32) }),
        transferLog({ contract: SPAM, amount: 1, block: head - 2, hash: "0x" + "b2".repeat(32) }),
      ],
      meta: { [SPAM]: { symbol: "SPAM", name: "Spam", decimals: 18 } },
    });

    const result = await syncInboundTransfers({ userId: user._id, chainId: CHAIN_ID, address: WALLET });

    expect(result.failed).toBe(false);
    expect(result.limited).toBe(true);
    expect(await cursorOf(user._id)).toBe(head);
    const rows = await WalletTx.find({ userId: user._id }).lean();
    expect(rows.map((r) => r.symbol)).toEqual([known.symbol]);
    const u = await User.findById(user._id).lean();
    expect((u.discoveredTokens || []).length).toBe(0);
    expect(calls.some((c) => c.address)).toBe(true);
  });

  it("does not fall back when the node could not be reached at all", async () => {
    const user = await makeUser();
    const head = 1000;
    const calls = fakeChain({ head, failWindows: [{ from: Math.max(0, head - spanFor(getChain(CHAIN_ID)) + 1) }] });
    const result = await syncInboundTransfers({ userId: user._id, chainId: CHAIN_ID, address: WALLET });
    expect(result.failed).toBe(true);
    expect(result.limited).toBe(false);
    expect(calls.every((c) => !c.address)).toBe(true);
  });

  it("runs one sync per wallet per chain when asked twice at once", async () => {
    const user = await makeUser();
    const calls = fakeChain({ head: 5_000 });
    await Promise.all([
      syncInboundTransfers({ userId: user._id, chainId: CHAIN_ID, address: WALLET }),
      syncInboundTransfers({ userId: user._id, chainId: CHAIN_ID, address: WALLET }),
    ]);
    expect(calls).toHaveLength(4);
  });
});

describe("contract string decoding", () => {
  it("decodes a standard ABI string", () => {
    expect(decodeAbiString(abiString("USDC"))).toBe("USDC");
    expect(decodeAbiString(abiString(""))).toBe("");
  });

  it("decodes a bare bytes32 symbol", () => {
    const hex = "0x" + Buffer.from("MKR").toString("hex").padEnd(64, "0");
    expect(decodeAbiString(hex)).toBe("MKR");
  });

  it("returns null rather than guessing on anything else", () => {
    expect(decodeAbiString("0x")).toBeNull();
    expect(decodeAbiString(null)).toBeNull();
    expect(decodeAbiString("0x1234")).toBeNull();
    expect(decodeAbiString("0xzz")).toBeNull();
  });

  it("strips control and invisible characters from what a contract claims", () => {
    expect(sanitizeText(String.fromCharCode(8203) + "USDC" + String.fromCharCode(0) + " ", 12)).toBe("USDC");
    expect(sanitizeText("  Spam   Token  ", 48)).toBe("Spam Token");
    expect(sanitizeText("A".repeat(40), 12)).toHaveLength(12);
    expect(sanitizeText(String.fromCharCode(8203, 8203), 12)).toBeNull();
    expect(sanitizeText(null, 12)).toBeNull();
  });
});
