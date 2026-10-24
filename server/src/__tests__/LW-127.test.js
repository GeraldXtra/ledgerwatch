const webpush = require("web-push");

const vapid = webpush.generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = vapid.publicKey;
process.env.VAPID_PRIVATE_KEY = vapid.privateKey;
process.env.VAPID_SUBJECT = "mailto:test@example.com";

const User = require("../models/User");
const WalletTx = require("../models/WalletTx");
const PushSubscription = require("../models/PushSubscription");
const rpcService = require("../services/rpc.service");
const notifyService = require("../services/notify.service");
const walletActivity = require("../services/walletActivity.service");
const { syncInboundTransfers } = require("../services/walletHistory.service");

const CHAIN = 84532;
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const WALLET = "0x1111111111111111111111111111111111111111";
const STRANGER = "0x2222222222222222222222222222222222222222";

let seq = 0;
const hash = () => "0x" + (++seq).toString(16).padStart(64, "0");
const topic = (a) => "0x" + a.toLowerCase().replace(/^0x/, "").padStart(64, "0");

let pushes;
let emails;

async function anOwner(extra = {}) {
  const user = await User.create({
    name: "Owner",
    email: `lw127-${Date.now()}-${++seq}@example.com`,
    passwordHash: "x",
    emailVerified: true,
    walletAddress: WALLET,
    ...extra,
  });
  await PushSubscription.create({
    userId: user._id,
    endpoint: `https://fcm.googleapis.com/fcm/send/lw127-${seq}`,
    keys: { p256dh: "B".repeat(87), auth: "A".repeat(22) },
  });
  return user;
}

async function aPendingTx(user, extra = {}) {
  return WalletTx.create({
    userId: user._id,
    chainId: CHAIN,
    hash: hash(),
    from: WALLET,
    to: STRANGER,
    value: "12.5",
    symbol: "USDC",
    tokenAddress: USDC,
    direction: "out",
    status: "pending",
    kind: "transfer",
    createdAt: new Date(Date.now() - 60 * 1000),
    ...extra,
  });
}

function chainAnswers(handler) {
  vi.spyOn(rpcService, "rpcCallTyped").mockImplementation(async (chain, method, params) => handler(method, params));
  vi.spyOn(rpcService, "rpcCall").mockImplementation(async (chain, method, params) => {
    const r = await handler(method, params);
    return r && r.ok ? r.result : null;
  });
}

beforeEach(() => {
  walletActivity._resetForTests();
  pushes = [];
  emails = [];
  vi.spyOn(webpush, "sendNotification").mockImplementation(async (sub, body) => {
    pushes.push(JSON.parse(body));
    return { statusCode: 201 };
  });
  vi.spyOn(notifyService, "sendEmail").mockImplementation(async (to, subject, html, opts) => {
    emails.push({ to, subject, html, text: opts && opts.text, attachments: opts && opts.attachments });
    return { ok: true };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("LW-127 — wallet outcomes are announced by the server, once, whether or not a tab is open", () => {
  it("settles a confirmed transfer, notifies every device and emails a receipt with the logo", async () => {
    const user = await anOwner();
    const tx = await aPendingTx(user);
    chainAnswers((method) => (method === "eth_getTransactionReceipt" ? { ok: true, result: { status: "0x1" } } : { ok: false, reason: "unexpected" }));

    const out = await walletActivity.runWalletTxPass({ userId: user._id });
    expect(out).toMatchObject({ checked: 1, settled: 1 });
    await vi.waitFor(() => expect(emails).toHaveLength(1));

    expect((await WalletTx.findById(tx._id)).status).toBe("confirmed");
    expect(pushes).toHaveLength(1);
    expect(pushes[0]).toMatchObject({ title: "Sent 12.5 USDC", type: "txUpdates" });
    expect(emails[0].subject).toBe("You sent 12.5 USDC");
    expect(emails[0].html).toContain("cid:ledgerwatch-logo");
    expect(emails[0].attachments[0]).toMatchObject({ cid: "ledgerwatch-logo" });
    expect(emails[0].html).toContain("https://sepolia.basescan.org/tx/");
  });

  it("never announces the same transaction twice", async () => {
    const user = await anOwner();
    const tx = await aPendingTx(user);
    chainAnswers(() => ({ ok: true, result: { status: "0x1" } }));
    await walletActivity.runWalletTxPass({ userId: user._id });
    await Promise.all([walletActivity.announceWalletTx(tx._id), walletActivity.announceWalletTx(tx._id)]);
    await walletActivity.runWalletTxPass({ userId: user._id });
    await vi.waitFor(() => expect(pushes).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(pushes).toHaveLength(1);
  });

  it("reports a reverted transfer as failed, without a receipt email", async () => {
    const user = await anOwner();
    const tx = await aPendingTx(user);
    chainAnswers(() => ({ ok: true, result: { status: "0x0" } }));
    await walletActivity.runWalletTxPass({ userId: user._id });
    await vi.waitFor(() => expect(pushes).toHaveLength(1));
    expect((await WalletTx.findById(tx._id)).status).toBe("failed");
    expect(pushes[0].title).toBe("Transfer failed on Base Sepolia");
    expect(emails).toHaveLength(0);
  });

  it("leaves a transaction pending when the chain cannot be reached", async () => {
    const user = await anOwner();
    const tx = await aPendingTx(user);
    chainAnswers(() => ({ ok: false, reason: "timeout" }));
    await walletActivity.runWalletTxPass({ userId: user._id });
    expect((await WalletTx.findById(tx._id)).status).toBe("pending");
    expect(pushes).toHaveLength(0);
  });

  it("marks a transaction failed only when the chain has neither its receipt nor the transaction, hours later", async () => {
    const user = await anOwner();
    const young = await aPendingTx(user);
    const old = await aPendingTx(user, { createdAt: new Date(Date.now() - walletActivity.UNSEEN_FAIL_AFTER_MS - 60 * 1000) });
    const seen = await aPendingTx(user, { createdAt: new Date(Date.now() - walletActivity.UNSEEN_FAIL_AFTER_MS - 60 * 1000) });
    chainAnswers((method, params) => {
      if (method === "eth_getTransactionReceipt") return { ok: true, result: null };
      if (method === "eth_getTransactionByHash") return { ok: true, result: params[0] === seen.hash ? { hash: seen.hash } : null };
      return { ok: false, reason: "unexpected" };
    });
    await walletActivity.runWalletTxPass({ userId: user._id });
    expect((await WalletTx.findById(young._id)).status).toBe("pending");
    expect((await WalletTx.findById(old._id)).status).toBe("failed");
    expect((await WalletTx.findById(seen._id)).status).toBe("pending");
  });

  it("names a bought token in a live trade notification and attaches its stored logo", async () => {
    const CoinLogo = require("../models/CoinLogo");
    await CoinLogo.create({ coinId: "ethereum", image: "https://coin-images.coingecko.com/coins/images/279/large/ethereum.png" });
    const user = await anOwner();
    await aPendingTx(user, {
      kind: "swap",
      side: "buy",
      to: "0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4",
      value: "100",
      symbol: "USDC",
      tokenOut: "0x4200000000000000000000000000000000000006",
      tokenOutSymbol: "WETH",
      amountOut: "0.03",
    });
    chainAnswers(() => ({ ok: true, result: { status: "0x1", logs: [] } }));
    await walletActivity.runWalletTxPass({ userId: user._id });
    await vi.waitFor(() => expect(pushes).toHaveLength(1));
    expect(pushes[0]).toMatchObject({ title: "Bought 0.03 WETH", type: "trades" });
    expect(pushes[0].icon).toBe("https://coin-images.coingecko.com/coins/images/279/large/ethereum.png");
  });

  it("does not email when the owner switched activity emails off, but still notifies", async () => {
    const user = await anOwner({ notifyPrefs: { emailActivity: false } });
    await aPendingTx(user);
    chainAnswers(() => ({ ok: true, result: { status: "0x1" } }));
    await walletActivity.runWalletTxPass({ userId: user._id });
    await vi.waitFor(() => expect(pushes).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(emails).toHaveLength(0);
  });
});

describe("LW-127 — money arriving in the wallet is noticed and announced", () => {
  function logsChain({ head, logs, balance = "0x0" }) {
    chainAnswers((method) => {
      if (method === "eth_blockNumber") return { ok: true, result: "0x" + head.toString(16) };
      if (method === "eth_getLogs") return { ok: true, result: logs };
      if (method === "eth_getBalance") return { ok: true, result: balance };
      return { ok: false, reason: "unexpected" };
    });
  }

  function usdcIn(block, amount) {
    return {
      address: USDC,
      topics: [TRANSFER, topic(STRANGER), topic(WALLET)],
      data: "0x" + BigInt(amount).toString(16).padStart(64, "0"),
      blockNumber: "0x" + block.toString(16),
      transactionHash: hash(),
    };
  }

  it("announces a recent arrival of a known token once the wallet has been scanned before", async () => {
    const head = 5_000_000;
    const user = await anOwner({ walletHistoryCursors: [{ chainId: CHAIN, block: head - 100 }] });
    logsChain({ head, logs: [usdcIn(head - 10, 25_000_000)] });
    const sync = await syncInboundTransfers({ userId: user._id, chainId: CHAIN, address: WALLET });
    expect(sync).toMatchObject({ added: 1, announced: 1 });
    await vi.waitFor(() => expect(pushes).toHaveLength(1));
    expect(pushes[0]).toMatchObject({ title: "Received 25 USDC", type: "moneyIn" });
    await vi.waitFor(() => expect(emails).toHaveLength(1));
    expect(emails[0].subject).toBe("You received 25 USDC");
  });

  it("stays quiet on the very first scan, which only reads history", async () => {
    const head = 5_000_000;
    const user = await anOwner();
    logsChain({ head, logs: [usdcIn(head - 10, 25_000_000)] });
    const sync = await syncInboundTransfers({ userId: user._id, chainId: CHAIN, address: WALLET });
    expect(sync).toMatchObject({ added: 1, announced: 0 });
    await new Promise((r) => setTimeout(r, 50));
    expect(pushes).toHaveLength(0);
  });

  it("does not announce an arrival older than six hours found while catching up", async () => {
    const head = 5_000_000;
    const sixHoursOfBlocks = (6 * 60 * 60) / 2;
    const user = await anOwner({ walletHistoryCursors: [{ chainId: CHAIN, block: head - sixHoursOfBlocks - 500 }] });
    logsChain({ head, logs: [usdcIn(head - sixHoursOfBlocks - 100, 25_000_000)] });
    const sync = await syncInboundTransfers({ userId: user._id, chainId: CHAIN, address: WALLET });
    expect(sync.announced).toBe(0);
  });

  it("never announces a token nobody added, which is how airdrop scams get attention", async () => {
    const head = 5_000_000;
    const user = await anOwner({ walletHistoryCursors: [{ chainId: CHAIN, block: head - 100 }] });
    const scam = { ...usdcIn(head - 10, 1), address: "0x9999999999999999999999999999999999999999" };
    chainAnswers((method, params) => {
      if (method === "eth_blockNumber") return { ok: true, result: "0x" + head.toString(16) };
      if (method === "eth_getLogs") return { ok: true, result: [scam] };
      if (method === "eth_call") return { ok: true, result: "0x" };
      return { ok: false, reason: "unexpected" };
    });
    const sync = await syncInboundTransfers({ userId: user._id, chainId: CHAIN, address: WALLET });
    expect(sync.announced).toBe(0);
    await new Promise((r) => setTimeout(r, 50));
    expect(pushes).toHaveLength(0);
  });

  it("notices native coin arriving by its balance going up, after a first reading", async () => {
    const user = await anOwner();
    const { getChain } = require("../config/chains");
    const chain = getChain(CHAIN);
    logsChain({ head: 1, logs: [], balance: "0x" + (10n ** 17n).toString(16) });
    expect(await walletActivity.checkNativeArrival({ userId: user._id, chain, address: WALLET, since: Date.now() })).toBe(0);
    logsChain({ head: 1, logs: [], balance: "0x" + (3n * 10n ** 17n).toString(16) });
    expect(await walletActivity.checkNativeArrival({ userId: user._id, chain, address: WALLET, since: Date.now() })).toBe(1);
    await vi.waitFor(() => expect(pushes).toHaveLength(1));
    expect(pushes[0].title).toBe("Received 0.2 ETH");
  });

  it("does not take a failed balance read, or a balance explained by a swap, as money arriving", async () => {
    const user = await anOwner();
    const { getChain } = require("../config/chains");
    const chain = getChain(CHAIN);
    logsChain({ head: 1, logs: [], balance: "0x" + (10n ** 17n).toString(16) });
    await walletActivity.checkNativeArrival({ userId: user._id, chain, address: WALLET, since: Date.now() });
    chainAnswers(() => ({ ok: false, reason: "timeout" }));
    expect(await walletActivity.checkNativeArrival({ userId: user._id, chain, address: WALLET, since: Date.now() })).toBe(0);
    await aPendingTx(user, { kind: "swap", side: "sell", status: "confirmed", createdAt: new Date() });
    logsChain({ head: 1, logs: [], balance: "0x" + (5n * 10n ** 17n).toString(16) });
    expect(await walletActivity.checkNativeArrival({ userId: user._id, chain, address: WALLET, since: Date.now() })).toBe(0);
    expect(pushes).toHaveLength(0);
  });

  it("runs from the loop at most once per interval for each wallet and chain", async () => {
    const head = 5_000_000;
    const user = await anOwner({ walletHistoryCursors: [{ chainId: CHAIN, block: head - 100 }] });
    logsChain({ head, logs: [] });
    const first = await walletActivity.runInboundPass({ userId: user._id });
    const second = await walletActivity.runInboundPass({ userId: user._id });
    expect(first.checked).toBeGreaterThanOrEqual(1);
    expect(second.checked).toBe(0);
  });
});

describe("LW-127 — money arriving or leaving on Bitcoin, Litecoin, Dogecoin, TRON, Solana and TON is announced", () => {
  const LTC = "ltc1qjmxnz78nmc8nq77wuxh25n2es7rzm5c2rkk4wh";
  const LATER = 60 * 60 * 1000;
  let balance;

  function litecoinAnswers() {
    vi.stubGlobal("fetch", async () => {
      if (balance === null) return { ok: false, status: 503, text: async () => "down" };
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ chain_stats: { funded_txo_sum: balance, spent_txo_sum: 0, tx_count: 1 }, mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0, tx_count: 0 } }),
      };
    });
  }

  afterEach(() => vi.unstubAllGlobals());

  it("records a first balance quietly, then announces what arrives and what leaves", async () => {
    const user = await anOwner({ chainAddresses: [{ chain: "litecoin", network: "mainnet", address: LTC }] });
    litecoinAnswers();

    balance = 1000;
    expect((await walletActivity.runChainWatchPass({ userId: user._id })).announced).toBe(0);
    expect(pushes).toHaveLength(0);

    balance = 6000;
    expect((await walletActivity.runChainWatchPass({ userId: user._id, now: Date.now() + LATER })).announced).toBe(1);
    await vi.waitFor(() => expect(pushes).toHaveLength(1));
    expect(pushes[0]).toMatchObject({ title: "Received 0.00005 LTC", type: "moneyIn" });
    await vi.waitFor(() => expect(emails).toHaveLength(1));

    balance = 2000;
    await walletActivity.runChainWatchPass({ userId: user._id, now: Date.now() + 2 * LATER });
    await vi.waitFor(() => expect(pushes).toHaveLength(2));
    expect(pushes[1].title).toBe("0.00004 LTC left your Litecoin wallet");
    expect(pushes[1].body).toMatch(/If you did not send this/);
  });

  it("does not take an unreadable balance as a change, and does not check again before its time", async () => {
    const user = await anOwner({ chainAddresses: [{ chain: "litecoin", network: "mainnet", address: LTC }] });
    litecoinAnswers();
    balance = 1000;
    await walletActivity.runChainWatchPass({ userId: user._id });
    expect((await walletActivity.runChainWatchPass({ userId: user._id })).checked).toBe(0);

    balance = null;
    await walletActivity.runChainWatchPass({ userId: user._id, now: Date.now() + LATER });
    balance = 1000;
    expect((await walletActivity.runChainWatchPass({ userId: user._id, now: Date.now() + 3 * LATER })).announced).toBe(0);
    expect(pushes).toHaveLength(0);
  });
});
