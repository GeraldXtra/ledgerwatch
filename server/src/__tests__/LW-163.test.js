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
    if (r && r.__http) return { ok: false, reason: `all 1 endpoint(s) failed: node-a: HTTP ${r.__http}`, attempts: [{ host: "node-a", status: r.__http, reason: `HTTP ${r.__http}` }] };
    if (r && r.__rpcError) return { ok: false, reason: `rpc error: ${r.__rpcError}`, attempts: r.__attempts || [] };
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
const history = require("../services/walletHistory.service");

const CHAIN_ID = 84532;
const WALLET = "0x1111111111111111111111111111111111111111";
const SENDER = "0x2222222222222222222222222222222222222222";
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e".toLowerCase();
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const pad = (addr) => "0x" + addr.toLowerCase().slice(2).padStart(64, "0");
const word = (n) => BigInt(n).toString(16).padStart(64, "0");

function transferLog({ contract, amount, block, hash }) {
  return { address: contract, topics: [TRANSFER, pad(SENDER), pad(WALLET)], data: "0x" + word(amount), blockNumber: "0x" + block.toString(16), transactionHash: hash, removed: false };
}

function fakeChain({ head, logs = [], maxUnfilteredSpan = Infinity, unfilteredError = null, secondNode = null }) {
  const calls = [];
  rpcCall.mockReset();
  rpcCall.mockImplementation(async (chain, method, params) => {
    if (method === "eth_blockNumber") return "0x" + head.toString(16);
    if (method === "eth_getLogs") {
      const from = parseInt(params[0].fromBlock, 16);
      const to = parseInt(params[0].toBlock, 16);
      const filtered = Array.isArray(params[0].address);
      calls.push({ from, to, span: to - from + 1, filtered });
      if (!filtered && unfilteredError) return unfilteredError;
      if (!filtered && to - from + 1 > maxUnfilteredSpan) {
        if (secondNode) return { __rpcError: secondNode, __attempts: [{ host: "node-a", status: 413, reason: "HTTP 413" }] };
        return { __http: 413 };
      }
      return logs.filter((l) => {
        const b = parseInt(l.blockNumber, 16);
        if (filtered && !params[0].address.map((a) => String(a).toLowerCase()).includes(String(l.address).toLowerCase())) return false;
        return b >= from && b <= to;
      });
    }
    return null;
  });
  return calls;
}

beforeEach(() => history._resetDiscoveryForTests());

async function owner() {
  return User.create({ name: "Owner", email: `lw163-${Date.now()}-${Math.random()}@example.com`, passwordHash: "x", walletAddress: WALLET, walletHistoryCursors: [{ chainId: CHAIN_ID, block: 9_000 }] });
}

describe("LW-163 — a node that refuses a wide log query is asked in narrower pieces", () => {
  it("splits the window until the node answers, keeps the cursor moving and finds the arrival", async () => {
    const user = await owner();
    const head = 10_000;
    const calls = fakeChain({ head, maxUnfilteredSpan: 200, logs: [transferLog({ contract: USDC, amount: 5_000_000, block: 9_700, hash: "0x" + "a".repeat(64) })] });

    const r = await history.syncInboundTransfers({ userId: user._id, chainId: CHAIN_ID, address: WALLET });

    expect(r.failed).toBe(false);
    expect(calls.some((c) => c.span > 200 && !c.filtered)).toBe(true);
    expect(calls.filter((c) => !c.filtered && c.span <= 200).length).toBeGreaterThan(0);
    const u = await User.findById(user._id).lean();
    expect(u.walletHistoryCursors.find((c) => c.chainId === CHAIN_ID).block).toBe(head);
    expect(await WalletTx.countDocuments({ userId: user._id, hash: "0x" + "a".repeat(64) })).toBe(1);
  });

  it("remembers the span the node accepts, so the next load asks in that size from the start", async () => {
    const user = await owner();
    fakeChain({ head: 10_000, maxUnfilteredSpan: 200 });
    await history.syncInboundTransfers({ userId: user._id, chainId: CHAIN_ID, address: WALLET });
    const calls = fakeChain({ head: 11_000, maxUnfilteredSpan: 200 });
    const r = await history.syncInboundTransfers({ userId: user._id, chainId: CHAIN_ID, address: WALLET });
    expect(r.failed).toBe(false);
    expect(calls.every((c) => c.span <= 200)).toBe(true);
  });

  it("splits when the first node's 413 fell through to a node that wants an address, as on Base Sepolia", async () => {
    const user = await owner();
    const calls = fakeChain({ head: 10_000, maxUnfilteredSpan: 200, secondNode: "Please specify an address in your request or, to remove restrictions, order a dedicated full node here", logs: [transferLog({ contract: USDC, amount: 7_000_000, block: 9_900, hash: "0x" + "b".repeat(64) })] });
    const r = await history.syncInboundTransfers({ userId: user._id, chainId: CHAIN_ID, address: WALLET });
    expect(r.failed).toBe(false);
    expect(r.limited).toBe(false);
    expect(calls.filter((c) => !c.filtered && c.span <= 200).length).toBeGreaterThan(0);
    expect(await WalletTx.countDocuments({ userId: user._id, hash: "0x" + "b".repeat(64) })).toBe(1);
  });

  it("does not split for a node that wants an address, falls back to the known tokens, and says so", async () => {
    const user = await owner();
    const calls = fakeChain({ head: 10_000, unfilteredError: { __rpcError: "Please specify an address in your request or, to remove restrictions, order a dedicated full node here" } });
    const r = await history.syncInboundTransfers({ userId: user._id, chainId: CHAIN_ID, address: WALLET });
    expect(r.failed).toBe(false);
    expect(r.limited).toBe(true);
    expect(calls.filter((c) => !c.filtered)).toHaveLength(1);
    expect(calls.filter((c) => c.filtered).length).toBeGreaterThan(0);
  });

  it("gives up at a hundred blocks and does not hammer a node that refuses everything", async () => {
    const user = await owner();
    const calls = fakeChain({ head: 10_000, maxUnfilteredSpan: 10 });
    const r = await history.syncInboundTransfers({ userId: user._id, chainId: CHAIN_ID, address: WALLET });
    expect(r.failed).toBe(false);
    expect(r.limited).toBe(true);
    const unfiltered = calls.filter((c) => !c.filtered);
    expect(Math.min(...unfiltered.map((c) => c.span))).toBeGreaterThanOrEqual(history.MIN_DISCOVERY_SPAN / 2);
    expect(unfiltered.length).toBeLessThan(40);
    const again = fakeChain({ head: 10_500, maxUnfilteredSpan: 10 });
    await history.syncInboundTransfers({ userId: user._id, chainId: CHAIN_ID, address: WALLET });
    expect(again.filter((c) => !c.filtered)).toHaveLength(0);
  });
});
