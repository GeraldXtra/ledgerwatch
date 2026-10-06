import { ethers } from "ethers";
import { getProvider, ERC20_ABI } from "../wallet/provider";
import { deriveSignerFromWallet } from "../wallet/derivation";
import { recordTx, updateTxStatus } from "../wallet/walletApi";
import {
  ERC20_TRANSFER_GAS_FALLBACK,
  currentGasPrice,
  estimateGasWithFallback,
} from "../wallet/gas";
import { recordSweep } from "./cryptoApi";

export { ERC20_TRANSFER_GAS_FALLBACK };

const GAS_BUFFER_NUMERATOR = 3n;
const GAS_BUFFER_DENOMINATOR = 2n;

function tokenContract(pa, runner) {
  return new ethers.Contract(pa.tokenContract, ERC20_ABI, runner);
}

export async function planSweep({ paymentAddress: pa, chain, destination, mainAddress }) {
  const provider = getProvider(pa.chainId);
  const token = tokenContract(pa, provider);

  const rawBalance = await token.balanceOf(pa.address);
  const decimals = Number(pa.tokenDecimals) || 6;
  const amount = Number(ethers.formatUnits(rawBalance, decimals));

  const nativeBalance = await provider.getBalance(pa.address);

  let gasLimit = null;
  let gasSource = "estimated";
  let gasRevertReason = null;
  if (rawBalance > 0n) {
    const estimated = await estimateGasWithFallback({
      provider,
      tx: {
        to: pa.tokenContract,
        data: token.interface.encodeFunctionData("transfer", [destination, rawBalance]),
      },
      from: pa.address,
      fallbackFrom: mainAddress,
      fallback: ERC20_TRANSFER_GAS_FALLBACK,
    });
    gasLimit = estimated.gasLimit;
    gasSource = estimated.source;

    if (estimated.reverted) {
      gasRevertReason = estimated.reverted;
    }
  }

  const gasPrice = await currentGasPrice(provider);
  const feeWei = gasLimit ? gasLimit * gasPrice : 0n;
  const fundingWei = (feeWei * GAS_BUFFER_NUMERATOR) / GAS_BUFFER_DENOMINATOR;
  const needsGasFunding = rawBalance > 0n && nativeBalance < feeWei;

  return {
    paymentAddressId: pa._id,
    debtId: pa.debtId,
    chainId: pa.chainId,
    chainName: chain ? chain.name : `Chain ${pa.chainId}`,
    nativeSymbol: chain ? chain.nativeSymbol : "ETH",
    address: pa.address,
    derivationIndex: pa.derivationIndex,
    tokenSymbol: pa.tokenSymbol,
    tokenContract: pa.tokenContract,
    decimals,
    destination,
    rawBalance,
    amount,
    amountNgn: amount * (Number(pa.ngnPerUsd) || 0),
    nativeBalance,
    gasLimit,
    gasPrice,
    feeWei,
    fundingWei,
    needsGasFunding,
    gasSource,
    planFailed: gasRevertReason
      ? `The network says this transfer would fail: ${gasRevertReason}`
      : undefined,
    empty: rawBalance === 0n,
  };
}

export async function executeSweep({ master, plan, onStep = () => {} }) {
  const provider = getProvider(plan.chainId);
  const mainSigner = master.connect(provider);
  let gasFundedTxHash = null;

  if (plan.needsGasFunding) {
    onStep("Sending gas");
    const fundTx = await mainSigner.sendTransaction({
      to: plan.address,
      value: plan.fundingWei,
    });
    gasFundedTxHash = fundTx.hash;

    const fundRecord = await recordTx({
      chainId: plan.chainId,
      hash: fundTx.hash,
      from: master.address,
      to: plan.address,
      value: ethers.formatEther(plan.fundingWei),
      symbol: plan.nativeSymbol,
      tokenAddress: null,
      direction: "out",
    }).catch((err) => {
      console.error("[sweep] gas funding is on chain but was not recorded:", err && err.message);
      return null;
    });

    onStep("Waiting for gas to confirm");
    const receipt = await fundTx.wait();
    if (fundRecord && fundRecord._id) {
      await updateTxStatus(
        fundRecord._id,
        receipt && receipt.status === 1 ? "confirmed" : "failed"
      ).catch(() => {});
    }
    if (!receipt || receipt.status !== 1) {
      throw new Error("The gas funding transaction failed, so nothing was swept.");
    }
  }

  onStep("Sweeping");
  const derived = deriveSignerFromWallet(master, plan.derivationIndex, provider);

  const token = tokenContract(plan, derived);
  const raw = await token.balanceOf(plan.address);
  if (raw === 0n) throw new Error("This address is already empty.");

  const txResp = await token.transfer(plan.destination, raw);
  const amount = Number(ethers.formatUnits(raw, plan.decimals));

  const record = await recordTx({
    chainId: plan.chainId,
    hash: txResp.hash,
    from: plan.address,
    to: plan.destination,
    value: String(amount),
    symbol: plan.tokenSymbol,
    tokenAddress: plan.tokenContract,
    direction: "in",
  }).catch(() => null);

  let sweepRecorded = true;
  await recordSweep(plan.paymentAddressId, {
    txHash: txResp.hash,
    destination: plan.destination,
    amountUsdc: amount,
    gasFundedTxHash,
  }).catch((err) => {
    sweepRecorded = false;
    console.error("[sweep] the transfer is on chain but the sweep was not recorded:", err && err.message);
  });

  if (record && record._id) {
    txResp
      .wait()
      .then((r) => updateTxStatus(record._id, r && r.status === 1 ? "confirmed" : "failed"))
      .catch(() => {});
  }

  return { txHash: txResp.hash, amount, gasFundedTxHash, recorded: sweepRecorded };
}

export async function executeSweepBatch({ master, plans, onRow = () => {} }) {
  const results = [];
  for (const plan of plans) {
    try {
      onRow(plan.paymentAddressId, { state: "working", step: "Starting" });
      const res = await executeSweep({
        master,
        plan,
        onStep: (step) => onRow(plan.paymentAddressId, { state: "working", step }),
      });
      onRow(plan.paymentAddressId, {
        state: "done",
        txHash: res.txHash,
        amount: res.amount,
        unrecorded: res.recorded === false,
      });
      results.push({ plan, ok: true, ...res });
    } catch (err) {
      const message = friendlySweepError(err);
      onRow(plan.paymentAddressId, { state: "failed", error: message });
      results.push({ plan, ok: false, error: message });
    }
  }
  return results;
}

export function friendlySweepError(err) {
  const msg = (err && (err.shortMessage || err.reason || err.message)) || "Sweep failed";
  if (/incorrect password|invalid password|could not decrypt/i.test(msg)) {
    return "Incorrect password.";
  }
  if (/insufficient funds/i.test(msg)) {
    return "Your main wallet does not have enough native token to cover gas.";
  }
  return msg;
}
