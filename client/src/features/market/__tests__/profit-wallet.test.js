import { describe, it, expect, vi, beforeEach } from "vitest";
import { ethers } from "ethers";

vi.mock("../../../api/http", () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock("../../wallet/walletApi", () => ({ recordTx: vi.fn(), updateTxStatus: vi.fn() }));
vi.mock("../../wallet/provider", async (importOriginal) => ({ ...(await importOriginal()), getProvider: vi.fn() }));

import { recordTx, updateTxStatus } from "../../wallet/walletApi";
import { getProvider } from "../../wallet/provider";
import {
  PROFIT_PATH,
  executeProfitMove,
  executeProfitWithdraw,
  planProfitMove,
  profitSignerFrom,
} from "../profitWallet";
import { CHAIN_ID, fakeChain } from "../../wallet/__tests__/fakeChain";

const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const TRANSFER = new ethers.Interface(["function transfer(address,uint256)"]);

let events;

const profit = {
  _id: "p1",
  chainId: CHAIN_ID,
  symbol: "WETH",
  profitUsd: 21,
  profitAmount: "21.5",
  cashSymbol: "USDC",
  cashAddress: USDC,
  cashDecimals: 6,
};

beforeEach(() => {
  events = [];
  vi.mocked(recordTx).mockReset();
  vi.mocked(updateTxStatus).mockReset();
  vi.mocked(getProvider).mockReset();
  vi.mocked(updateTxStatus).mockResolvedValue({});
  vi.mocked(recordTx).mockImplementation(async (tx) => {
    events.push("record");
    return { _id: "row1", ...tx };
  });
});

describe("profit wallet — Account 2 of the same recovery phrase", () => {
  it("is the standard second account, so any wallet that imports the phrase shows it", () => {
    const master = ethers.Wallet.createRandom();
    expect(master.path).toBe("m/44'/60'/0'/0/0");
    expect(PROFIT_PATH).toBe("m/44'/60'/0'/0/1");
    const expected = ethers.HDNodeWallet.fromPhrase(master.mnemonic.phrase, "", "m/44'/60'/0'/0/1").address;
    expect(profitSignerFrom(master).address).toBe(expected);
    expect(profitSignerFrom(master).address).not.toBe(master.address);
  });

  it("cannot be made from a wallet imported by private key alone", () => {
    const bare = new ethers.Wallet(ethers.Wallet.createRandom().privateKey);
    expect(() => profitSignerFrom(bare)).toThrow(/recovery phrase/);
  });

  it("moves exactly the recorded profit, records it with its profit id, and only then broadcasts", async () => {
    const chain = fakeChain({ events, tokenBalance: 100_000_000n });
    vi.mocked(getProvider).mockReturnValue(chain.provider);
    const master = ethers.Wallet.createRandom();
    const plan = await planProfitMove({ profit, from: master.address });
    expect(plan).toMatchObject({ enoughToken: true, enoughGas: true, raw: 21_500_000n });

    const out = await executeProfitMove({ master, profit, plan });
    const destination = profitSignerFrom(master).address;
    expect(out.destination).toBe(destination);

    const recorded = vi.mocked(recordTx).mock.calls[0][0];
    expect(recorded).toMatchObject({ profitId: "p1", to: destination, value: "21.5", tokenAddress: USDC, direction: "out" });
    expect(events.indexOf("record")).toBeLessThan(events.indexOf("eth_sendRawTransaction"));

    const [to, amount] = TRANSFER.decodeFunctionData("transfer", chain.sent[0].data);
    expect(to).toBe(destination);
    expect(amount).toBe(21_500_000n);
  });

  it("refuses to plan a move larger than what the trading wallet holds", async () => {
    const chain = fakeChain({ events, tokenBalance: 1_000_000n });
    vi.mocked(getProvider).mockReturnValue(chain.provider);
    const plan = await planProfitMove({ profit, from: ethers.Wallet.createRandom().address });
    expect(plan.enoughToken).toBe(false);
  });

  it("will not move funds out of an address that is not this phrase's profit wallet", async () => {
    const chain = fakeChain({ events, tokenBalance: 5_000_000n });
    vi.mocked(getProvider).mockReturnValue(chain.provider);
    const master = ethers.Wallet.createRandom();
    const plan = {
      chainId: CHAIN_ID,
      token: { address: USDC, symbol: "USDC", decimals: 6 },
      profitAddress: ethers.Wallet.createRandom().address,
      mainAddress: master.address,
      needsGasFunding: false,
    };
    await expect(executeProfitWithdraw({ master, plan })).rejects.toThrow(/does not belong/);
    expect(chain.sent).toHaveLength(0);
    expect(recordTx).not.toHaveBeenCalled();
  });
});
