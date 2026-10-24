import * as btc from "@scure/btc-signer";
import { networkParams, signBitcoinTransaction } from "./derivation.js";

export const DUST_LIMIT_SATS = 546;

export const RBF_SEQUENCE = 0xfffffffd;

export const MIN_RELAY_SAT_PER_VB = 1;

const P2WPKH_INPUT_VBYTES = 68;

const TX_OVERHEAD_VBYTES = 8.5;

function countVbytes(n) {
  if (n < 253) return 1;
  if (n <= 0xffff) return 3;
  return 5;
}

function outputVbytes(scriptLen) {
  return 8 + countVbytes(scriptLen) + scriptLen;
}

export function estimateVsize(inputCount, outputScriptLengths) {
  const outputs = outputScriptLengths.reduce((sum, len) => sum + outputVbytes(len), 0);
  return Math.ceil(
    TX_OVERHEAD_VBYTES +
      countVbytes(inputCount) +
      countVbytes(outputScriptLengths.length) +
      inputCount * P2WPKH_INPUT_VBYTES +
      outputs
  );
}

export function estimateFee(inputCount, outputScriptLengths, feeRateSatPerVb) {
  return Math.ceil(estimateVsize(inputCount, outputScriptLengths) * feeRateSatPerVb);
}

function scriptFor(address, network) {
  const params = networkParams(network);
  return btc.OutScript.encode(btc.Address(params).decode(address));
}

export function validateDestination(address, network) {
  const value = String(address || "").trim();
  if (!value) return { ok: false, reason: "Enter the address to send to." };
  try {
    const script = scriptFor(value, network);
    return { ok: true, scriptLen: script.length };
  } catch (err) {
    const expected = network === "mainnet" ? "a Bitcoin address, beginning bc1" : "a Bitcoin testnet address, beginning tb1";
    return {
      ok: false,
      reason: `That destination is not usable on ${network}. It should be ${expected}. ${String(err.message || "").split("\n")[0]}`.trim(),
    };
  }
}

export function selectUtxos({ utxos, amountSats, feeRateSatPerVb, destScriptLen, changeScriptLen }) {
  const sorted = [...utxos].sort((a, b) => Number(b.value || 0) - Number(a.value || 0));

  const selected = [];
  let inputTotal = 0;

  for (const utxo of sorted) {
    selected.push(utxo);
    inputTotal += Number(utxo.value || 0);
    const shape = shapeFor({ selected, inputTotal, amountSats, feeRateSatPerVb, destScriptLen, changeScriptLen });
    if (shape) return { ok: true, selected, inputTotal, ...shape };
  }

  const shortfallFee = estimateFee(Math.max(sorted.length, 1), [destScriptLen, changeScriptLen], feeRateSatPerVb);
  const needed = amountSats + shortfallFee;
  return {
    ok: false,
    reason:
      `These coins cannot cover the payment. Sending ${amountSats} satoshis at ` +
      `${feeRateSatPerVb} satoshis per vbyte needs about ${needed} satoshis including the fee, ` +
      `and this address holds ${inputTotal}.`,
  };
}

function shapeFor({ selected, inputTotal, amountSats, feeRateSatPerVb, destScriptLen, changeScriptLen }) {
  const feeWithChange = estimateFee(selected.length, [destScriptLen, changeScriptLen], feeRateSatPerVb);
  const change = inputTotal - amountSats - feeWithChange;
  if (change >= DUST_LIMIT_SATS) {
    return { fee: feeWithChange, change, hasChange: true };
  }

  const feeNoChange = estimateFee(selected.length, [destScriptLen], feeRateSatPerVb);
  if (inputTotal - amountSats >= feeNoChange) {
    return { fee: inputTotal - amountSats, change: 0, hasChange: false };
  }
  return null;
}

export function planP2wpkhSpend({
  utxos,
  fromAddress,
  toAddress,
  amountSats,
  feeRateSatPerVb,
  network,
  allowUnconfirmed = false,
  forceInputs = null,
  replacing = null,
}) {
  if (!Array.isArray(utxos) && !Array.isArray(forceInputs)) {
    return { ok: false, reason: "No coins were supplied to spend from." };
  }
  if (!Number.isInteger(amountSats) || amountSats <= 0) {
    return { ok: false, reason: "The amount must be a whole number of satoshis above zero." };
  }
  if (amountSats < DUST_LIMIT_SATS) {
    return {
      ok: false,
      reason:
        `${amountSats} satoshis is below the dust limit of ${DUST_LIMIT_SATS}. ` +
        "The network will not relay a payment that small, because it would cost more to spend than it is worth.",
    };
  }
  if (!Number.isFinite(feeRateSatPerVb) || feeRateSatPerVb < MIN_RELAY_SAT_PER_VB) {
    return {
      ok: false,
      reason: `A fee rate of at least ${MIN_RELAY_SAT_PER_VB} satoshi per vbyte is required. Nothing below that is relayed.`,
    };
  }

  let destScript;
  let changeScript;
  try {
    destScript = scriptFor(String(toAddress || "").trim(), network);
  } catch (err) {
    return { ok: false, reason: `That destination address is not usable on ${network}. ${err.message}` };
  }
  try {
    changeScript = scriptFor(fromAddress, network);
  } catch (err) {
    return { ok: false, reason: `The sending address is not usable on ${network}. ${err.message}` };
  }

  if (!(changeScript.length === 22 && changeScript[0] === 0x00 && changeScript[1] === 0x14)) {
    return {
      ok: false,
      reason: "This builder spends native segwit addresses only. The sending address is not one.",
    };
  }

  let inputs;
  let inputTotal;
  let shape;

  if (Array.isArray(forceInputs)) {
    if (forceInputs.length === 0) {
      return { ok: false, reason: "No inputs were given to spend." };
    }
    inputs = forceInputs;
    inputTotal = inputs.reduce((sum, u) => sum + Number(u.value || 0), 0);
    shape = shapeFor({
      selected: inputs,
      inputTotal,
      amountSats,
      feeRateSatPerVb,
      destScriptLen: destScript.length,
      changeScriptLen: changeScript.length,
    });
    if (!shape) {
      const needed = amountSats + estimateFee(inputs.length, [destScript.length], feeRateSatPerVb);
      return {
        ok: false,
        reason:
          `Those inputs cannot cover the payment at this fee. Sending ${amountSats} satoshis at ` +
          `${feeRateSatPerVb} satoshis per vbyte needs at least ${needed} satoshis, and they hold ${inputTotal}.`,
      };
    }
  } else {
    const usable = utxos.filter((u) => allowUnconfirmed || u.confirmed !== false);
    if (usable.length === 0) {
      const pending = utxos.reduce((sum, u) => sum + (u.value || 0), 0);
      if (utxos.length > 0 && !allowUnconfirmed) {
        return {
          ok: false,
          reason: `All ${pending} satoshis at this address are still unconfirmed. Wait for a confirmation before sending.`,
        };
      }
      return { ok: false, reason: "This address holds no coins to spend." };
    }

    const selection = selectUtxos({
      utxos: usable,
      amountSats,
      feeRateSatPerVb,
      destScriptLen: destScript.length,
      changeScriptLen: changeScript.length,
    });
    if (!selection.ok) return selection;
    inputs = selection.selected;
    inputTotal = selection.inputTotal;
    shape = { fee: selection.fee, change: selection.change, hasChange: selection.hasChange };
  }

  const outputLens = shape.hasChange ? [destScript.length, changeScript.length] : [destScript.length];
  const vsize = estimateVsize(inputs.length, outputLens);

  if (replacing) {
    const oldFee = Number(replacing.fee || 0);
    const oldRate = Number(replacing.feeRateSatPerVb || 0);
    const minFee = oldFee + Math.ceil(vsize * MIN_RELAY_SAT_PER_VB);
    if (shape.fee < minFee) {
      return {
        ok: false,
        reason:
          `A replacement must pay at least ${minFee} satoshis in fee: the ${oldFee} it replaces ` +
          `plus its own relay cost. At ${feeRateSatPerVb} satoshis per vbyte this one pays ${shape.fee}. Raise the rate.`,
      };
    }
    if (feeRateSatPerVb <= oldRate) {
      return {
        ok: false,
        reason: `The new rate must be higher than the ${oldRate} satoshis per vbyte the original paid.`,
      };
    }
  }

  return {
    ok: true,
    inputs,
    inputTotal,
    fee: shape.fee,
    change: shape.change,
    hasChange: shape.hasChange,
    vsize,
    feeRateSatPerVb,
    amountSats,
    toAddress: String(toAddress).trim(),
  };
}

export function buildP2wpkhSpend(args) {
  const { privateKey, network, fromAddress } = args;
  const plan = planP2wpkhSpend(args);
  if (!plan.ok) return plan;

  const params = networkParams(network);
  const changeScript = scriptFor(fromAddress, network);
  const tx = new btc.Transaction();

  for (const utxo of plan.inputs) {
    tx.addInput({
      txid: utxo.txid,
      index: utxo.vout,
      witnessUtxo: { script: changeScript, amount: BigInt(utxo.value) },
      sequence: RBF_SEQUENCE,
    });
  }

  tx.addOutputAddress(plan.toAddress, BigInt(plan.amountSats), params);

  if (plan.hasChange) {
    tx.addOutputAddress(fromAddress, BigInt(plan.change), params);
  }

  let signed;
  try {
    signed = signBitcoinTransaction(tx, privateKey);
  } catch (err) {
    return { ok: false, reason: err.message };
  }

  if (signed.fee > plan.amountSats && !args.allowFeeAboveAmount) {
    return {
      ok: false,
      reason:
        `The fee of ${signed.fee} satoshis would be larger than the ${plan.amountSats} satoshis being sent, ` +
        "so the transaction was not completed. Lower the fee rate or send a larger amount.",
    };
  }

  return {
    ok: true,
    hex: signed.hex,
    txid: signed.txid,
    vsize: signed.vsize,
    fee: signed.fee,
    feeRateSatPerVb: Number((signed.fee / signed.vsize).toFixed(2)),
    change: plan.change,
    inputs: plan.inputs,
    inputTotal: plan.inputTotal,
  };
}

export function planCancel({ inputs, fromAddress, feeRateSatPerVb, network, replacing }) {
  if (!Array.isArray(inputs) || inputs.length === 0) {
    return { ok: false, reason: "There is no transaction to cancel." };
  }
  let changeLen;
  try {
    changeLen = scriptFor(fromAddress, network).length;
  } catch (err) {
    return { ok: false, reason: `The sending address is not usable on ${network}. ${err.message}` };
  }
  const inputTotal = inputs.reduce((sum, u) => sum + Number(u.value || 0), 0);
  const fee = estimateFee(inputs.length, [changeLen], feeRateSatPerVb);
  const amountSats = inputTotal - fee;
  if (amountSats < DUST_LIMIT_SATS) {
    return {
      ok: false,
      reason: `After a fee of ${fee} satoshis these inputs would leave ${amountSats}, which is below the dust floor. The rate is too high to cancel with these coins.`,
    };
  }
  const plan = planP2wpkhSpend({
    utxos: inputs,
    forceInputs: inputs,
    fromAddress,
    toAddress: fromAddress,
    amountSats,
    feeRateSatPerVb,
    network,
    allowUnconfirmed: true,
    replacing,
  });
  if (!plan.ok) return plan;
  return { ok: true, amountSats, fee: plan.fee, vsize: plan.vsize };
}
