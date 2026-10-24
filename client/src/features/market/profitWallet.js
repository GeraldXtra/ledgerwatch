import { ethers } from "ethers";
import http from "../../api/http";
import { getProvider, ERC20_ABI } from "../wallet/provider";
import { canDerive } from "../wallet/derivation";
import { updateTxStatus } from "../wallet/walletApi";
import { sendRecorded, trackConfirmation, waitForReceipt } from "../wallet/broadcast";
import { ERC20_TRANSFER_GAS_FALLBACK, currentGasPrice, estimateGasWithFallback } from "../wallet/gas";

export const PROFIT_PATH = "m/44'/60'/0'/0/1";

const TRACKING_MS = 30 * 60 * 1000;
const FUNDING_WAIT_MS = 10 * 60 * 1000;
const GAS_BUFFER_NUMERATOR = 3n;
const GAS_BUFFER_DENOMINATOR = 2n;

const CANNOT_DERIVE =
  "This wallet was imported from a private key, so it has no recovery phrase and cannot hold a separate profit wallet. Re-import it using your recovery phrase to move profit.";

export async function fetchProfits(mode) {
  const { data } = await http.get("/api/profits", { params: mode ? { mode } : {} });
  return data;
}

export async function keepProfitInTradingWallet(id) {
  const { data } = await http.post(`/api/profits/${id}/dismiss`);
  return data.profit;
}

export function profitSignerFrom(master, provider) {
  if (!canDerive(master)) throw new Error(CANNOT_DERIVE);
  const node = ethers.HDNodeWallet.fromPhrase(master.mnemonic.phrase, "", PROFIT_PATH);
  return provider ? node.connect(provider) : node;
}

function transferData(to, raw) {
  return new ethers.Interface(ERC20_ABI).encodeFunctionData("transfer", [to, raw]);
}

export async function planProfitMove({ profit, from }) {
  if (!profit || !profit.profitAmount || !profit.cashAddress) {
    throw new Error("This profit has no amount to move.");
  }
  const provider = getProvider(profit.chainId);
  const decimals = Number(profit.cashDecimals);
  const raw = ethers.parseUnits(String(profit.profitAmount), decimals);
  const token = new ethers.Contract(profit.cashAddress, ERC20_ABI, provider);
  const [balance, native, gasPrice] = await Promise.all([
    token.balanceOf(from),
    provider.getBalance(from),
    currentGasPrice(provider),
  ]);
  const estimated = await estimateGasWithFallback({
    provider,
    tx: { to: profit.cashAddress, data: transferData(from, raw) },
    from,
    fallback: ERC20_TRANSFER_GAS_FALLBACK,
  });
  const feeWei = estimated.gasLimit * gasPrice;
  return {
    raw,
    decimals,
    amount: String(profit.profitAmount),
    symbol: profit.cashSymbol,
    balance,
    enoughToken: balance >= raw,
    native,
    feeWei,
    enoughGas: native >= feeWei,
    reverted: estimated.reverted || null,
  };
}

export async function executeProfitMove({ master, profit, plan }) {
  const provider = getProvider(profit.chainId);
  const destination = profitSignerFrom(master).address;
  if (destination.toLowerCase() === master.address.toLowerCase()) {
    throw new Error("The profit wallet came out the same as your trading wallet, so nothing was sent.");
  }
  const sent = await sendRecorded({
    signer: master.connect(provider),
    provider,
    request: { to: profit.cashAddress, data: transferData(destination, plan.raw) },
    record: {
      chainId: profit.chainId,
      from: master.address,
      to: destination,
      value: String(profit.profitAmount),
      symbol: profit.cashSymbol,
      tokenAddress: profit.cashAddress,
      direction: "out",
      profitId: profit._id,
    },
    label: "profit transfer",
  });
  trackConfirmation({
    provider,
    hash: sent.hash,
    response: sent.sent.response,
    timeoutMs: TRACKING_MS,
    onSettled: (status) => updateTxStatus(sent.row._id, status),
  });
  return {
    hash: sent.hash,
    destination,
    broadcast: sent.sent.outcome === "accepted" ? "sent" : "unknown",
    broadcastReason: sent.sent.outcome === "accepted" ? null : sent.sent.reason,
  };
}

export async function planProfitWithdraw({ chainId, token, profitAddress, mainAddress }) {
  const provider = getProvider(chainId);
  const contract = new ethers.Contract(token.address, ERC20_ABI, provider);
  const [raw, native, gasPrice] = await Promise.all([
    contract.balanceOf(profitAddress),
    provider.getBalance(profitAddress),
    currentGasPrice(provider),
  ]);
  let gasLimit = ERC20_TRANSFER_GAS_FALLBACK;
  if (raw > 0n) {
    const estimated = await estimateGasWithFallback({
      provider,
      tx: { to: token.address, data: transferData(mainAddress, raw) },
      from: profitAddress,
      fallbackFrom: mainAddress,
      fallback: ERC20_TRANSFER_GAS_FALLBACK,
    });
    gasLimit = estimated.gasLimit;
  }
  const feeWei = gasLimit * gasPrice;
  return {
    chainId,
    token,
    profitAddress,
    mainAddress,
    raw,
    amount: ethers.formatUnits(raw, token.decimals),
    native,
    feeWei,
    fundingWei: (feeWei * GAS_BUFFER_NUMERATOR) / GAS_BUFFER_DENOMINATOR,
    needsGasFunding: raw > 0n && native < feeWei,
    empty: raw === 0n,
  };
}

export async function executeProfitWithdraw({ master, plan, nativeSymbol, onStep = () => {}, fundingWaitMs = FUNDING_WAIT_MS }) {
  const provider = getProvider(plan.chainId);
  const profitSigner = profitSignerFrom(master, provider);
  if (profitSigner.address.toLowerCase() !== plan.profitAddress.toLowerCase()) {
    throw new Error("That profit wallet does not belong to this recovery phrase, so nothing was sent.");
  }

  if (plan.needsGasFunding) {
    onStep("Sending gas to the profit wallet");
    const funding = await sendRecorded({
      signer: master.connect(provider),
      provider,
      request: { to: plan.profitAddress, value: plan.fundingWei },
      record: {
        chainId: plan.chainId,
        from: master.address,
        to: plan.profitAddress,
        value: ethers.formatEther(plan.fundingWei),
        symbol: nativeSymbol || "ETH",
        tokenAddress: null,
        direction: "out",
      },
      label: "gas transfer",
    });
    onStep("Waiting for the gas to confirm");
    const status = await waitForReceipt({ provider, hash: funding.hash, sent: funding.sent, waitMs: fundingWaitMs });
    if (status) await updateTxStatus(funding.row._id, status).catch(() => {});
    if (status === "failed") throw new Error("The gas transfer failed, so nothing was moved.");
    if (status !== "confirmed") {
      throw new Error(
        `The gas was sent (${funding.hash.slice(0, 10)}…) but has not confirmed yet, so nothing was moved. ` +
          "Wait for it to confirm, then try again."
      );
    }
  }

  onStep("Moving the profit");
  const contract = new ethers.Contract(plan.token.address, ERC20_ABI, provider);
  const raw = await contract.balanceOf(plan.profitAddress);
  if (raw === 0n) throw new Error("The profit wallet holds none of this token any more.");
  const sent = await sendRecorded({
    signer: profitSigner,
    provider,
    request: { to: plan.token.address, data: transferData(plan.mainAddress, raw) },
    record: {
      chainId: plan.chainId,
      from: plan.profitAddress,
      to: plan.mainAddress,
      value: ethers.formatUnits(raw, plan.token.decimals),
      symbol: plan.token.symbol,
      tokenAddress: plan.token.address,
      direction: "in",
    },
    label: "transfer",
  });
  trackConfirmation({
    provider,
    hash: sent.hash,
    response: sent.sent.response,
    timeoutMs: TRACKING_MS,
    onSettled: (status) => updateTxStatus(sent.row._id, status),
  });
  return { hash: sent.hash, amount: ethers.formatUnits(raw, plan.token.decimals) };
}
