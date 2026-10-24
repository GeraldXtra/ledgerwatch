import { ethers } from "ethers";
import { getProvider, ERC20_ABI } from "../wallet/provider";
import { deriveSignerFromWallet } from "../wallet/derivation";
import { updateTxStatus } from "../wallet/walletApi";
import { sendRecorded, trackConfirmation, waitForReceipt } from "../wallet/broadcast";
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

const FUNDING_WAIT_MS = 10 * 60 * 1000;
const SWEEP_TRACKING_MS = 30 * 60 * 1000;

export async function executeSweep({ master, plan, onStep = () => {}, fundingWaitMs = FUNDING_WAIT_MS }) {
  const provider = getProvider(plan.chainId);
  const mainSigner = master.connect(provider);
  let gasFundedTxHash = null;

  if (plan.needsGasFunding) {
    onStep("Sending gas");
    const funding = await sendRecorded({
      signer: mainSigner,
      provider,
      request: { to: plan.address, value: plan.fundingWei },
      record: {
        chainId: plan.chainId,
        from: master.address,
        to: plan.address,
        value: ethers.formatEther(plan.fundingWei),
        symbol: plan.nativeSymbol,
        tokenAddress: null,
        direction: "out",
      },
      label: "gas transfer",
    });
    gasFundedTxHash = funding.hash;

    onStep("Waiting for gas to confirm");
    const status = await waitForReceipt({ provider, hash: funding.hash, sent: funding.sent, waitMs: fundingWaitMs });
    if (status) await updateTxStatus(funding.row._id, status).catch(() => {});
    if (status === "failed") {
      throw new Error("The gas funding transaction failed, so nothing was swept.");
    }
    if (status !== "confirmed") {
      throw new Error(
        `The gas for this sweep was sent (${funding.hash.slice(0, 10)}…) but has not confirmed yet, so ` +
          "nothing was swept. Wait for it to confirm, then sweep again; the gas will not be sent twice."
      );
    }
  }

  onStep("Sweeping");
  const derived = deriveSignerFromWallet(master, plan.derivationIndex, provider);

  const token = tokenContract(plan, derived);
  const raw = await token.balanceOf(plan.address);
  if (raw === 0n) throw new Error("This address is already empty.");
  const amount = Number(ethers.formatUnits(raw, plan.decimals));

  const sweep = await sendRecorded({
    signer: derived,
    provider,
    request: {
      to: plan.tokenContract,
      data: new ethers.Interface(ERC20_ABI).encodeFunctionData("transfer", [plan.destination, raw]),
    },
    record: {
      chainId: plan.chainId,
      from: plan.address,
      to: plan.destination,
      value: String(amount),
      symbol: plan.tokenSymbol,
      tokenAddress: plan.tokenContract,
      direction: "in",
    },
    label: "sweep",
  });

  let sweepRecorded = true;
  await recordSweep(plan.paymentAddressId, {
    txHash: sweep.hash,
    destination: plan.destination,
    amountUsdc: amount,
    gasFundedTxHash,
  }).catch((err) => {
    sweepRecorded = false;
    console.error("[sweep] the transfer was sent but the sweep was not recorded:", err && err.message);
  });

  trackConfirmation({
    provider,
    hash: sweep.hash,
    response: sweep.sent.response,
    timeoutMs: SWEEP_TRACKING_MS,
    onSettled: (status) => updateTxStatus(sweep.row._id, status),
  });

  return {
    txHash: sweep.hash,
    amount,
    gasFundedTxHash,
    recorded: sweepRecorded,
    broadcast: sweep.sent.outcome === "accepted" ? "sent" : "unknown",
    broadcastReason: sweep.sent.outcome === "accepted" ? null : sweep.sent.reason,
  };
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
        unconfirmed: res.broadcast === "unknown",
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
