import { describe, it, expect, vi, beforeEach } from "vitest";
import { ethers } from "ethers";

vi.mock("../walletApi", () => ({ recordTx: vi.fn(), updateTxStatus: vi.fn() }));
vi.mock("../provider", async (importOriginal) => ({ ...(await importOriginal()), getProvider: vi.fn() }));
vi.mock("../../receivables/cryptoApi", () => ({ recordSweep: vi.fn() }));

import { recordTx, updateTxStatus } from "../walletApi";
import { getProvider } from "../provider";
import { recordSweep } from "../../receivables/cryptoApi";
import { sendRecorded } from "../broadcast";
import { executeSweep } from "../../receivables/sweep";
import { deriveSignerFromWallet } from "../derivation";
import { CHAIN_ID, fakeChain } from "./fakeChain";

const DESTINATION = "0x2222222222222222222222222222222222222222";
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

let events;

beforeEach(() => {
  events = [];
  vi.mocked(recordTx).mockReset();
  vi.mocked(updateTxStatus).mockReset();
  vi.mocked(recordSweep).mockReset();
  vi.mocked(getProvider).mockReset();
  vi.mocked(updateTxStatus).mockResolvedValue({});
  vi.mocked(recordSweep).mockResolvedValue({});
  let n = 0;
  vi.mocked(recordTx).mockImplementation(async (tx) => {
    events.push(`record:${tx.direction}`);
    n += 1;
    return { _id: `row${n}`, ...tx };
  });
});

describe("LW-119 — a transfer is recorded before it is broadcast", () => {
  it("records under the signed hash, then broadcasts", async () => {
    const chain = fakeChain({ events });
    const signer = ethers.Wallet.createRandom().connect(chain.provider);
    const out = await sendRecorded({
      signer,
      provider: chain.provider,
      request: { to: DESTINATION, value: 1000n },
      record: { chainId: CHAIN_ID, from: signer.address, to: DESTINATION, value: "0.000000000000001", symbol: "ETH", direction: "out" },
      label: "transfer",
    });
    expect(out.sent.outcome).toBe("accepted");
    expect(out.hash).toBe(chain.sent[0].hash);
    expect(vi.mocked(recordTx).mock.calls[0][0].hash).toBe(out.hash);
    expect(events.indexOf("record:out")).toBeLessThan(events.indexOf("eth_sendRawTransaction"));
  });

  it("sends nothing when the record cannot be saved", async () => {
    vi.mocked(recordTx).mockRejectedValue(Object.assign(new Error("Network Error"), { response: { data: { error: "Failed to record transaction" } } }));
    const chain = fakeChain({ events });
    const signer = ethers.Wallet.createRandom().connect(chain.provider);
    await expect(
      sendRecorded({ signer, provider: chain.provider, request: { to: DESTINATION, value: 1n }, record: { direction: "out" }, label: "transfer" })
    ).rejects.toThrow(/This transfer was signed but not sent.*Nothing was sent.*Failed to record transaction/s);
    expect(chain.sent).toHaveLength(0);
  });

  it("marks the record failed when the network refuses", async () => {
    const chain = fakeChain({ events, onSend: () => ({ error: { code: -32000, message: "insufficient funds for gas * price + value" } }) });
    const signer = ethers.Wallet.createRandom().connect(chain.provider);
    await expect(
      sendRecorded({ signer, provider: chain.provider, request: { to: DESTINATION, value: 1n }, record: { direction: "out" }, label: "transfer" })
    ).rejects.toThrow(/refused this transfer, so nothing was sent: insufficient funds/);
    expect(updateTxStatus).toHaveBeenCalledWith("row1", "failed");
  });

  it("keeps the record and reports an ambiguous broadcast instead of failing it", async () => {
    const chain = fakeChain({ events, onSend: () => ({ http: 502, body: { error: "RPC upstream failed", reason: "ETIMEDOUT", broadcast: "unknown" } }) });
    const signer = ethers.Wallet.createRandom().connect(chain.provider);
    const out = await sendRecorded({ signer, provider: chain.provider, request: { to: DESTINATION, value: 1n }, record: { direction: "out" }, label: "transfer" });
    expect(out.sent.outcome).toBe("unknown");
    expect(updateTxStatus).not.toHaveBeenCalled();
  });
});

describe("LW-119 — a sweep follows the same order, gas first", () => {
  const master = ethers.Wallet.createRandom();

  function plan(overrides = {}) {
    const derived = deriveSignerFromWallet(master, 3, null);
    return {
      chainId: CHAIN_ID,
      paymentAddressId: "pa1",
      address: derived.address,
      derivationIndex: 3,
      destination: DESTINATION,
      tokenContract: USDC,
      tokenSymbol: "USDC",
      decimals: 6,
      nativeSymbol: "ETH",
      needsGasFunding: false,
      fundingWei: 0n,
      ...overrides,
    };
  }

  it("records the sweep before sending it, then records it on the invoice address", async () => {
    const chain = fakeChain({ events, tokenBalance: 25_000_000n });
    vi.mocked(getProvider).mockReturnValue(chain.provider);
    const res = await executeSweep({ master, plan: plan() });
    expect(res.broadcast).toBe("sent");
    expect(chain.sent).toHaveLength(1);
    expect(res.txHash).toBe(chain.sent[0].hash);
    expect(events.indexOf("record:in")).toBeLessThan(events.indexOf("eth_sendRawTransaction"));
    expect(recordSweep).toHaveBeenCalledWith("pa1", expect.objectContaining({ txHash: res.txHash, amountUsdc: 25 }));
  });

  it("funds gas, waits for it to confirm, then sweeps", async () => {
    const chain = fakeChain({ events, tokenBalance: 25_000_000n });
    vi.mocked(getProvider).mockReturnValue(chain.provider);
    const res = await executeSweep({ master, plan: plan({ needsGasFunding: true, fundingWei: 10n ** 15n }) });
    expect(chain.sent).toHaveLength(2);
    expect(chain.sent[0].to).toBe(plan().address);
    expect(res.gasFundedTxHash).toBe(chain.sent[0].hash);
    expect(updateTxStatus).toHaveBeenCalledWith("row1", "confirmed");
  });

  it("stops before sweeping when the gas transfer reverts", async () => {
    const chain = fakeChain({ events, tokenBalance: 25_000_000n, receiptStatus: () => "0x0" });
    vi.mocked(getProvider).mockReturnValue(chain.provider);
    await expect(executeSweep({ master, plan: plan({ needsGasFunding: true, fundingWei: 10n ** 15n }) })).rejects.toThrow(
      /gas funding transaction failed, so nothing was swept/
    );
    expect(chain.sent).toHaveLength(1);
    expect(updateTxStatus).toHaveBeenCalledWith("row1", "failed");
  });

  it("stops, with the hash, when the gas has not confirmed in time", async () => {
    const chain = fakeChain({ events, tokenBalance: 25_000_000n, receiptStatus: () => null });
    vi.mocked(getProvider).mockReturnValue(chain.provider);
    await expect(
      executeSweep({ master, plan: plan({ needsGasFunding: true, fundingWei: 10n ** 15n }), fundingWaitMs: 300 })
    ).rejects.toThrow(/was sent \(0x[0-9a-f]{8}…\) but has not confirmed yet, so nothing was swept/);
    expect(chain.sent).toHaveLength(1);
  });

  it("does not send the sweep when it cannot be recorded first", async () => {
    vi.mocked(recordTx).mockRejectedValue(new Error("Network Error"));
    const chain = fakeChain({ events, tokenBalance: 25_000_000n });
    vi.mocked(getProvider).mockReturnValue(chain.provider);
    await expect(executeSweep({ master, plan: plan() })).rejects.toThrow(/This sweep was signed but not sent/);
    expect(chain.sent).toHaveLength(0);
    expect(recordSweep).not.toHaveBeenCalled();
  });
});
