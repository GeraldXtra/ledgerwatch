import { ethers } from "ethers";
import { getProvider, ERC20_ABI } from "../wallet/provider";
import { deriveSignerFromWallet } from "../wallet/derivation";
import { recordTx, updateTxStatus } from "../wallet/walletApi";
import { recordSweep } from "./cryptoApi";

/**
 * SWEEPING — moving stablecoin collected at a per-invoice derived address into
 * the owner's main wallet.
 *
 * This is the ONLY part of the crypto receivables feature that spends user
 * funds. It is therefore always password-signed in the browser, never automatic,
 * and never initiated by the agent. The derived key exists only inside
 * executeSweep and goes out of scope on return.
 *
 * THE GAS PROBLEM is the whole difficulty here. A derived address holds only
 * USDC and zero native token, so it cannot pay for its own ERC-20 transfer. The
 * main wallet has to send it a little native first, as a separate transaction
 * that must confirm before the sweep can be signed. That is handled explicitly
 * below rather than being allowed to fail as "insufficient funds".
 */

// An ERC-20 transfer to an address that already holds a balance costs ~45k gas;
// to a fresh address ~65k. Used only when the node refuses to estimate at all,
// and the UI says so when it is used rather than presenting it as a real
// estimate.
export const ERC20_TRANSFER_GAS_FALLBACK = 100000n;

// Gas funding is buffered because the fee can rise between the funding
// transaction and the sweep. Under-funding strands the token: the address would
// hold USDC it still cannot move, needing another funding round.
const GAS_BUFFER_NUMERATOR = 3n;
const GAS_BUFFER_DENOMINATOR = 2n; // 1.5x

/** The token this address accepts, as a contract handle. */
function tokenContract(pa, runner) {
  return new ethers.Contract(pa.tokenContract, ERC20_ABI, runner);
}

/**
 * Work out what sweeping this address would involve, WITHOUT signing anything.
 *
 * @returns {Promise<object>} plan for the review screen
 */
export async function planSweep({ paymentAddress: pa, chain, destination, mainAddress }) {
  const provider = getProvider(pa.chainId);
  const token = tokenContract(pa, provider);

  // THE AMOUNT IS THE LIVE ON-CHAIN BALANCE, not pa.receivedUsdc. The stored
  // figure is what the watcher confirmed and settled; the balance is what is
  // actually sitting there. They diverge after a previous partial sweep, or if
  // funds arrived in a way the watcher did not attribute.
  const rawBalance = await token.balanceOf(pa.address);
  const decimals = Number(pa.tokenDecimals) || 6;
  const amount = Number(ethers.formatUnits(rawBalance, decimals));

  const nativeBalance = await provider.getBalance(pa.address);

  let gasLimit = null;
  let gasSource = "estimated";
  if (rawBalance > 0n) {
    const data = token.interface.encodeFunctionData("transfer", [destination, rawBalance]);
    try {
      // Preferred: estimate as the address that will actually send.
      gasLimit = await provider.estimateGas({ from: pa.address, to: pa.tokenContract, data });
    } catch {
      try {
        // Many nodes refuse to estimate from a zero-native address. The call
        // shape is identical, so estimating as the main wallet transfers.
        gasLimit = await provider.estimateGas({ from: mainAddress, to: pa.tokenContract, data });
        gasSource = "estimated from your main wallet";
      } catch {
        gasLimit = ERC20_TRANSFER_GAS_FALLBACK;
        gasSource = "a typical transfer cost, because this network would not estimate";
      }
    }
  }

  const fee = await provider.getFeeData();
  const gasPrice = fee.maxFeePerGas || fee.gasPrice || 0n;
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
    // Naira value at the rate snapshotted when the address was issued, so the
    // figure agrees with what the invoice and the reminder already stated.
    amountNgn: amount * (Number(pa.ngnPerUsd) || 0),
    nativeBalance,
    gasLimit,
    gasPrice,
    feeWei,
    fundingWei,
    needsGasFunding,
    gasSource,
    // Nothing to do — surfaced so the UI explains rather than offering a
    // no-op button.
    empty: rawBalance === 0n,
  };
}

/**
 * Sign and broadcast one sweep. Requires an ALREADY UNLOCKED master wallet so a
 * batch pays the scrypt cost once.
 *
 * `onStep(label)` reports progress, because the gas-funding wait is a real
 * 10-30s on testnet and must be shown as a step rather than a dead spinner.
 */
export async function executeSweep({ master, plan, onStep = () => {} }) {
  const provider = getProvider(plan.chainId);
  const mainSigner = master.connect(provider);
  let gasFundedTxHash = null;

  // ---- 1. Fund gas from the main wallet, if the derived address cannot pay ----
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
    }).catch(() => null);

    // MUST wait. Signing the sweep before the gas has landed produces a
    // transaction the address cannot pay for, which fails to broadcast.
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

  // ---- 2. Sweep the token out of the derived address ----
  onStep("Sweeping");
  const derived = deriveSignerFromWallet(master, plan.derivationIndex, provider);

  // Re-read the balance at signing time. Between planning and here a further
  // payment may have arrived, or a concurrent sweep may have emptied it.
  const token = tokenContract(plan, derived);
  const raw = await token.balanceOf(plan.address);
  if (raw === 0n) throw new Error("This address is already empty.");

  const txResp = await token.transfer(plan.destination, raw);
  const amount = Number(ethers.formatUnits(raw, plan.decimals));

  // Recorded as "in": from the owner's point of view this money is arriving in
  // their main wallet.
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

  await recordSweep(plan.paymentAddressId, {
    txHash: txResp.hash,
    destination: plan.destination,
    amountUsdc: amount,
    gasFundedTxHash,
  }).catch(() => {
    /* the transfer is already on chain; a failed bookkeeping call must not
       present as a failed sweep. The watcher and explorer remain the truth. */
  });

  // Settle the status in the background, exactly as SendForm does — a testnet
  // confirmation takes 10-30s and must not hold the UI.
  if (record && record._id) {
    txResp
      .wait()
      .then((r) => updateTxStatus(record._id, r && r.status === 1 ? "confirmed" : "failed"))
      .catch(() => {});
  }

  return { txHash: txResp.hash, amount, gasFundedTxHash };
}

/**
 * Sweep several addresses with one password entry.
 *
 * SEQUENTIAL, deliberately. Every gas-funding transaction originates from the
 * same main wallet, so running them concurrently would hand two transactions the
 * same nonce and one would be dropped.
 *
 * One failure never aborts the rest: each row reports its own outcome, so a
 * single bad address cannot cost the user the whole batch.
 */
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
      onRow(plan.paymentAddressId, { state: "done", txHash: res.txHash, amount: res.amount });
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
