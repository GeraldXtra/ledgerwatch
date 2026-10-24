import { describe, it, expect, vi, beforeEach } from "vitest";
import { ethers } from "ethers";

vi.mock("../../wallet/keystore", () => ({ unlockWallet: vi.fn() }));
vi.mock("../../wallet/walletApi", () => ({ recordTx: vi.fn(), updateTxStatus: vi.fn() }));
vi.mock("../../wallet/provider", async (importOriginal) => ({
  ...(await importOriginal()),
  getProvider: vi.fn(),
}));

import { unlockWallet } from "../../wallet/keystore";
import { recordTx, updateTxStatus } from "../../wallet/walletApi";
import { getProvider } from "../../wallet/provider";
import { classifyBroadcastError, settledStatus, trackConfirmation } from "../../wallet/broadcast";
import { approveRouter, executeSwap } from "../liveSwap";

const CHAIN_ID = 84532;
const ROUTER = "0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4";
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const TOKEN = "0x4200000000000000000000000000000000000006";
const ZERO_HASH = `0x${"00".repeat(32)}`;

function block(number) {
  return {
    hash: `0x${number.toString(16).padStart(64, "0")}`,
    parentHash: ZERO_HASH,
    number: ethers.toQuantity(number),
    timestamp: ethers.toQuantity(Math.floor(Date.now() / 1000)),
    nonce: "0x0000000000000000",
    difficulty: "0x0",
    gasLimit: "0x1c9c380",
    gasUsed: "0x0",
    miner: ethers.ZeroAddress,
    extraData: "0x",
    baseFeePerGas: "0x3b9aca00",
    transactions: [],
  };
}

function receipt(hash, from, status) {
  return {
    to: ROUTER,
    from,
    contractAddress: null,
    transactionIndex: "0x0",
    gasUsed: "0x30d40",
    logsBloom: `0x${"00".repeat(256)}`,
    blockHash: `0x${"11".repeat(32)}`,
    transactionHash: hash,
    logs: [],
    blockNumber: "0x64",
    cumulativeGasUsed: "0x30d40",
    effectiveGasPrice: "0x3b9aca00",
    status,
    type: "0x2",
  };
}

function fakeNetwork({ onSend, receiptStatus = "0x1", events }) {
  const sent = { raw: null, hash: null };
  const req = new ethers.FetchRequest("http://chain.test/rpc");
  req.getUrlFunc = async (r) => {
    const payload = JSON.parse(ethers.toUtf8String(r.body));
    const { method, params } = payload;
    events.push(method);
    const reply = (result) => ({ jsonrpc: "2.0", id: payload.id, result });
    let out;
    switch (method) {
      case "eth_chainId":
        out = reply(ethers.toQuantity(CHAIN_ID));
        break;
      case "eth_blockNumber":
        out = reply("0x64");
        break;
      case "eth_getTransactionCount":
        out = reply("0x7");
        break;
      case "eth_estimateGas":
        out = reply("0x30d40");
        break;
      case "eth_gasPrice":
      case "eth_maxPriorityFeePerGas":
        out = reply("0x3b9aca00");
        break;
      case "eth_getBlockByNumber":
        out = reply(block(100));
        break;
      case "eth_sendRawTransaction": {
        sent.raw = params[0];
        sent.hash = ethers.keccak256(params[0]);
        const verdict = onSend ? onSend(sent) : null;
        if (verdict && verdict.http) {
          return {
            statusCode: verdict.http,
            statusMessage: "Bad Gateway",
            headers: { "content-type": "application/json" },
            body: ethers.toUtf8Bytes(JSON.stringify(verdict.body)),
          };
        }
        out = verdict && verdict.error ? { jsonrpc: "2.0", id: payload.id, error: verdict.error } : reply(sent.hash);
        break;
      }
      case "eth_getTransactionReceipt":
        out = reply(receipt(params[0], ethers.ZeroAddress, receiptStatus));
        break;
      default:
        out = { jsonrpc: "2.0", id: payload.id, error: { code: -32601, message: `the method ${method} does not exist` } };
    }
    return {
      statusCode: 200,
      statusMessage: "OK",
      headers: { "content-type": "application/json" },
      body: ethers.toUtf8Bytes(JSON.stringify(out)),
    };
  };
  const provider = new ethers.JsonRpcProvider(req, CHAIN_ID, { staticNetwork: true, batchMaxCount: 1 });
  return { provider, sent };
}

async function broadcastError(onSend) {
  const events = [];
  const { provider } = fakeNetwork({ onSend, events });
  const wallet = ethers.Wallet.createRandom();
  const signed = await wallet.signTransaction({
    to: ROUTER,
    data: "0x",
    nonce: 1,
    gasLimit: 21000,
    maxFeePerGas: 2,
    maxPriorityFeePerGas: 1,
    chainId: CHAIN_ID,
    type: 2,
  });
  try {
    await provider.broadcastTransaction(signed);
  } catch (err) {
    return err;
  }
  return null;
}

function aPlan() {
  const iface = new ethers.Interface(["function multicall(uint256 deadline, bytes[] data)"]);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);
  return {
    chain: { chainId: CHAIN_ID, name: "Base Sepolia", dex: { router: ROUTER } },
    tokenIn: { symbol: "USDC", address: USDC, decimals: 6 },
    tokenOut: { symbol: "WETH", address: TOKEN, decimals: 18 },
    amountIn: 25_000_000n,
    amountInDisplay: 25,
    cashValueDisplay: 25,
    amountOutMinimum: 9_900_000_000_000_000n,
    quote: { amountOut: 10_000_000_000_000_000n, fee: 500, fees: [500], via: null, impactPct: 0.1 },
    swapTx: { to: ROUTER, data: iface.encodeFunctionData("multicall", [deadline, []]), deadline },
  };
}

describe("LW-091 — a failed broadcast is classified from the real error ethers raises", () => {
  it("treats a node's refusal as refused", async () => {
    const err = await broadcastError(() => ({ error: { code: -32000, message: "insufficient funds for gas * price + value" } }));
    expect(classifyBroadcastError(err)).toMatchObject({ outcome: "refused" });
  });

  it("treats nonce too low and an underpriced replacement as refused", async () => {
    for (const message of ["nonce too low", "replacement transaction underpriced", "max fee per gas less than block base fee"]) {
      const err = await broadcastError(() => ({ error: { code: -32000, message } }));
      expect(classifyBroadcastError(err).outcome).toBe("refused");
    }
  });

  it("treats already known as accepted, because the transaction is in the mempool", async () => {
    const err = await broadcastError(() => ({ error: { code: -32000, message: "already known" } }));
    expect(classifyBroadcastError(err).outcome).toBe("accepted");
  });

  it("treats an unrecognised node error as unknown, never as refused", async () => {
    const err = await broadcastError(() => ({ error: { code: -32603, message: "internal error" } }));
    expect(classifyBroadcastError(err).outcome).toBe("unknown");
  });

  it("reads the proxy's broadcast field from a 502", async () => {
    const notSent = await broadcastError(() => ({ http: 502, body: { error: "RPC upstream failed", reason: "ECONNREFUSED", broadcast: "not_sent" } }));
    expect(classifyBroadcastError(notSent).outcome).toBe("refused");
    const unknown = await broadcastError(() => ({ http: 502, body: { error: "RPC upstream failed", reason: "ETIMEDOUT", broadcast: "unknown" } }));
    expect(classifyBroadcastError(unknown).outcome).toBe("unknown");
    const silent = await broadcastError(() => ({ http: 502, body: { error: "RPC upstream failed" } }));
    expect(classifyBroadcastError(silent).outcome).toBe("unknown");
  });

  it("treats a request this server refused before forwarding as refused", async () => {
    const err = await broadcastError(() => ({ http: 403, body: { error: "Method not allowed: eth_sendRawTransaction" } }));
    expect(classifyBroadcastError(err).outcome).toBe("refused");
  });

  it("treats anything else as unknown", () => {
    expect(classifyBroadcastError(new TypeError("Failed to fetch")).outcome).toBe("unknown");
    expect(classifyBroadcastError(null).outcome).toBe("unknown");
  });
});

describe("LW-091 — a confirmation that reverted, or was replaced, is settled correctly", () => {
  it("maps a reverted receipt and a cancelled replacement to failed", () => {
    expect(settledStatus(ethers.makeError("reverted", "CALL_EXCEPTION", { receipt: { status: 0 } }))).toBe("failed");
    expect(settledStatus(ethers.makeError("replaced", "TRANSACTION_REPLACED", { cancelled: true }))).toBe("failed");
    expect(
      settledStatus(ethers.makeError("replaced", "TRANSACTION_REPLACED", { cancelled: false, receipt: { status: 1 } }))
    ).toBe("confirmed");
    expect(settledStatus(ethers.makeError("timeout", "TIMEOUT", {}))).toBe(null);
  });

  it("settles a hash it only knows by its receipt", async () => {
    const events = [];
    const { provider } = fakeNetwork({ events, receiptStatus: "0x0" });
    const onSettled = vi.fn();
    const status = await trackConfirmation({ provider, hash: `0x${"cd".repeat(32)}`, timeoutMs: 5000, onSettled });
    expect(status).toBe("failed");
    expect(onSettled).toHaveBeenCalledWith("failed");
  });
});

describe("LW-091 — a live swap is signed, recorded, and only then broadcast", () => {
  let events;

  beforeEach(() => {
    events = [];
    vi.mocked(unlockWallet).mockReset();
    vi.mocked(recordTx).mockReset();
    vi.mocked(updateTxStatus).mockReset();
    vi.mocked(getProvider).mockReset();
    vi.mocked(unlockWallet).mockResolvedValue(ethers.Wallet.createRandom());
    vi.mocked(updateTxStatus).mockResolvedValue({});
    vi.mocked(recordTx).mockImplementation(async (tx) => {
      events.push("record");
      return { _id: "tx1", ...tx };
    });
  });

  const run = (network) => {
    vi.mocked(getProvider).mockReturnValue(network.provider);
    return executeSwap({ plan: aPlan(), password: "pw", side: "buy", alertId: null });
  };

  it("records the swap under the hash of the signed bytes before anything is sent", async () => {
    const network = fakeNetwork({ events });
    const res = await run(network);
    expect(res.broadcast).toBe("sent");
    expect(events.indexOf("record")).toBeGreaterThan(-1);
    expect(events.indexOf("record")).toBeLessThan(events.indexOf("eth_sendRawTransaction"));
    expect(vi.mocked(recordTx).mock.calls[0][0].hash).toBe(network.sent.hash);
    expect(res.txHash).toBe(network.sent.hash);
    await vi.waitFor(() => expect(updateTxStatus).toHaveBeenCalledWith("tx1", "confirmed"));
  });

  it("sends nothing when the record cannot be saved", async () => {
    vi.mocked(recordTx).mockRejectedValue(Object.assign(new Error("Network Error"), { response: { data: { error: "Failed to record transaction" } } }));
    const network = fakeNetwork({ events });
    await expect(run(network)).rejects.toThrow(/signed but not sent.*Nothing left your wallet/s);
    expect(events).not.toContain("eth_sendRawTransaction");
    expect(network.sent.raw).toBe(null);
  });

  it("marks the record failed and says nothing was sent when the network refuses", async () => {
    const network = fakeNetwork({ events, onSend: () => ({ error: { code: -32000, message: "insufficient funds for gas * price + value" } }) });
    await expect(run(network)).rejects.toThrow(/refused this swap, so nothing left your wallet: insufficient funds/);
    expect(updateTxStatus).toHaveBeenCalledWith("tx1", "failed");
  });

  it("keeps the record pending and reports the hash when the broadcast is ambiguous", async () => {
    const network = fakeNetwork({
      events,
      onSend: () => ({ http: 502, body: { error: "RPC upstream failed", reason: "ETIMEDOUT", broadcast: "unknown" } }),
    });
    const res = await run(network);
    expect(res.broadcast).toBe("unknown");
    expect(res.broadcastReason).toBe("ETIMEDOUT");
    expect(res.txHash).toBe(network.sent.hash);
    expect(updateTxStatus).not.toHaveBeenCalledWith("tx1", "failed");
  });

  it("treats already known as sent", async () => {
    const network = fakeNetwork({ events, onSend: () => ({ error: { code: -32000, message: "already known" } }) });
    const res = await run(network);
    expect(res.broadcast).toBe("sent");
  });

  it("marks a swap that reverted on chain as failed instead of leaving it pending", async () => {
    const network = fakeNetwork({ events, receiptStatus: "0x0" });
    const res = await run(network);
    expect(res.broadcast).toBe("sent");
    await vi.waitFor(() => expect(updateTxStatus).toHaveBeenCalledWith("tx1", "failed"));
  });

  it("reports an approval whose history record could not be saved, instead of only logging it", async () => {
    vi.mocked(recordTx).mockRejectedValue(new Error("Network Error"));
    const network = fakeNetwork({ events });
    vi.mocked(getProvider).mockReturnValue(network.provider);
    const approval = await approveRouter({ plan: aPlan(), password: "pw" });
    expect(approval.hash).toBe(network.sent.hash);
    expect(approval.recorded).toBe(false);
  });

  it("reports a saved approval as recorded", async () => {
    const network = fakeNetwork({ events });
    vi.mocked(getProvider).mockReturnValue(network.provider);
    const approval = await approveRouter({ plan: aPlan(), password: "pw" });
    expect(approval.recorded).toBe(true);
  });

  it("refuses an expired quote before unlocking the wallet", async () => {
    const plan = aPlan();
    plan.swapTx.deadline = BigInt(Math.floor(Date.now() / 1000) + 10);
    await expect(executeSwap({ plan, password: "pw", side: "buy" })).rejects.toThrow(/expired/);
    expect(unlockWallet).not.toHaveBeenCalled();
    expect(recordTx).not.toHaveBeenCalled();
  });
});
