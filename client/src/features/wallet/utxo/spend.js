import * as btc from "@scure/btc-signer";
import { coinConfig, formatUnits } from "./coins.js";

const RBF_SEQUENCE = 0xfffffffd;
const FINAL_SEQUENCE = 0xffffffff;

const P2WPKH_INPUT_VBYTES = 68;
const P2PKH_INPUT_BYTES = 148;
const SEGWIT_OVERHEAD = 8.5;
const LEGACY_OVERHEAD = 8;

function varintLen(n) {
  if (n < 253) return 1;
  if (n <= 0xffff) return 3;
  return 5;
}

export function estimateSize(cfg, inputCount, outputScriptLengths) {
  const outputs = outputScriptLengths.reduce((sum, len) => sum + 8 + varintLen(len) + len, 0);
  const segwit = cfg.script === "p2wpkh";
  return Math.ceil(
    (segwit ? SEGWIT_OVERHEAD : LEGACY_OVERHEAD) +
      varintLen(inputCount) +
      varintLen(outputScriptLengths.length) +
      inputCount * (segwit ? P2WPKH_INPUT_VBYTES : P2PKH_INPUT_BYTES) +
      outputs
  );
}

function feeFor(cfg, inputs, outputs, rate) {
  return Math.ceil(estimateSize(cfg, inputs, outputs) * rate);
}

function scriptFor(address, cfg) {
  return btc.OutScript.encode(btc.Address(cfg.net.params).decode(String(address || "").trim()));
}

export function validateUtxoDestination(address, coin, network) {
  const cfg = coinConfig(coin, network);
  const value = String(address || "").trim();
  if (!value) return { ok: false, reason: "Enter the address to send to." };
  try {
    return { ok: true, scriptLen: scriptFor(value, cfg).length };
  } catch {
    return {
      ok: false,
      reason: `That is not a ${cfg.label}${network === "mainnet" ? "" : ` ${network}`} address. One begins ${cfg.net.prefix}.`,
    };
  }
}

function amountText(cfg, units) {
  return `${formatUnits(units, cfg.decimals)} ${cfg.net.symbol}`;
}

function shapeFor(cfg, { selected, inputTotal, amount, rate, destLen, changeLen }) {
  const feeWithChange = feeFor(cfg, selected.length, [destLen, changeLen], rate);
  const change = inputTotal - amount - feeWithChange;
  if (change >= cfg.dust) return { fee: feeWithChange, change, hasChange: true };
  const feeNoChange = feeFor(cfg, selected.length, [destLen], rate);
  if (inputTotal - amount >= feeNoChange) return { fee: inputTotal - amount, change: 0, hasChange: false };
  return null;
}

export function planUtxoSpend({ coin, network, utxos, fromAddress, toAddress, amount, feeRate, allowUnconfirmed = false }) {
  let cfg;
  try {
    cfg = coinConfig(coin, network);
  } catch (err) {
    return { ok: false, reason: err.message };
  }
  if (!Array.isArray(utxos)) return { ok: false, reason: "No coins were supplied to spend from." };
  if (!Number.isInteger(amount) || amount <= 0) {
    return { ok: false, reason: `The amount must be a whole number of ${cfg.unitName} above zero.` };
  }
  if (amount < cfg.dust) {
    return {
      ok: false,
      reason: `${amountText(cfg, amount)} is below the smallest payment the ${cfg.label} network relays (${amountText(cfg, cfg.dust)}).`,
    };
  }
  if (!Number.isFinite(feeRate) || feeRate < cfg.minRate) {
    return { ok: false, reason: `A fee rate of at least ${cfg.minRate} ${cfg.rateUnit} is required.` };
  }

  let destScript;
  let changeScript;
  try {
    destScript = scriptFor(toAddress, cfg);
  } catch {
    return { ok: false, reason: `That destination is not a ${cfg.label} address. One begins ${cfg.net.prefix}.` };
  }
  try {
    changeScript = scriptFor(fromAddress, cfg);
  } catch {
    return { ok: false, reason: `The sending address is not a ${cfg.label} address.` };
  }
  const isP2wpkh = changeScript.length === 22 && changeScript[0] === 0x00 && changeScript[1] === 0x14;
  const isP2pkh = changeScript.length === 25 && changeScript[0] === 0x76 && changeScript[1] === 0xa9;
  if ((cfg.script === "p2wpkh" && !isP2wpkh) || (cfg.script === "p2pkh" && !isP2pkh)) {
    return { ok: false, reason: `The sending address is not the kind of ${cfg.label} address this wallet signs for.` };
  }

  const usable = utxos.filter((u) => allowUnconfirmed || u.confirmed !== false);
  if (usable.length === 0) {
    if (utxos.length > 0 && !allowUnconfirmed) {
      return { ok: false, reason: `Everything at this address is still unconfirmed. Wait for a confirmation before sending.` };
    }
    return { ok: false, reason: "This address holds no coins to spend." };
  }

  const sorted = [...usable].sort((a, b) => Number(b.value || 0) - Number(a.value || 0));
  const selected = [];
  let inputTotal = 0;
  let shape = null;
  for (const u of sorted) {
    selected.push(u);
    inputTotal += Number(u.value || 0);
    shape = shapeFor(cfg, { selected, inputTotal, amount, rate: feeRate, destLen: destScript.length, changeLen: changeScript.length });
    if (shape) break;
  }
  if (!shape) {
    const needed = amount + feeFor(cfg, Math.max(sorted.length, 1), [destScript.length, changeScript.length], feeRate);
    return {
      ok: false,
      reason: `Sending ${amountText(cfg, amount)} needs about ${amountText(cfg, needed)} including the fee, and this address holds ${amountText(cfg, inputTotal)}.`,
    };
  }

  const outputs = shape.hasChange ? [destScript.length, changeScript.length] : [destScript.length];
  return {
    ok: true,
    coin,
    network,
    inputs: selected,
    inputTotal,
    fee: shape.fee,
    change: shape.change,
    hasChange: shape.hasChange,
    size: estimateSize(cfg, selected.length, outputs),
    feeRate,
    amount,
    toAddress: String(toAddress).trim(),
    needsRawInputs: cfg.script === "p2pkh",
  };
}

function hexToBytes(hex) {
  const clean = String(hex || "");
  if (!/^([0-9a-f]{2})+$/i.test(clean)) throw new Error("A previous transaction was not valid hex.");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToHex(bytes) {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

function sameBytes(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function buildUtxoSpend({ privateKey, rawTxs = {}, ...args }) {
  const plan = planUtxoSpend(args);
  if (!plan.ok) return plan;
  const cfg = coinConfig(args.coin, args.network);
  if (!(privateKey instanceof Uint8Array) || privateKey.length !== 32) {
    return { ok: false, reason: "A signing key is required and must be thirty two bytes." };
  }

  const ownScript = scriptFor(args.fromAddress, cfg);
  const tx = new btc.Transaction({ allowUnknownOutputs: false });

  for (const u of plan.inputs) {
    if (cfg.script === "p2wpkh") {
      tx.addInput({
        txid: u.txid,
        index: u.vout,
        witnessUtxo: { script: ownScript, amount: BigInt(u.value) },
        sequence: cfg.rbf ? RBF_SEQUENCE : FINAL_SEQUENCE,
      });
      continue;
    }
    const raw = rawTxs[u.txid];
    if (!raw) return { ok: false, reason: `The previous transaction ${u.txid.slice(0, 12)}… could not be read, so it cannot be spent safely.` };
    let prev;
    try {
      prev = btc.Transaction.fromRaw(hexToBytes(raw), { allowUnknownOutputs: true, disableScriptCheck: true });
    } catch {
      return { ok: false, reason: `The previous transaction ${u.txid.slice(0, 12)}… could not be decoded, so it was not spent.` };
    }
    if (prev.id !== u.txid) {
      return { ok: false, reason: `The data service returned the wrong previous transaction for ${u.txid.slice(0, 12)}…, so nothing was signed.` };
    }
    const out = prev.getOutput(u.vout);
    if (!out || out.amount !== BigInt(u.value) || !sameBytes(out.script, ownScript)) {
      return {
        ok: false,
        reason: `The coin ${u.txid.slice(0, 12)}…:${u.vout} is not what the data service described, so nothing was signed.`,
      };
    }
    tx.addInput({ txid: u.txid, index: u.vout, nonWitnessUtxo: hexToBytes(raw), sequence: FINAL_SEQUENCE });
  }

  tx.addOutputAddress(plan.toAddress, BigInt(plan.amount), cfg.net.params);
  if (plan.hasChange) tx.addOutputAddress(args.fromAddress.trim(), BigInt(plan.change), cfg.net.params);

  const signed = tx.sign(privateKey);
  if (signed !== tx.inputsLength) {
    return { ok: false, reason: `This wallet could sign only ${signed} of ${tx.inputsLength} inputs, so nothing was sent.` };
  }
  tx.finalize();

  const fee = Number(tx.fee);
  if (fee !== plan.fee) {
    return { ok: false, reason: "The signed fee did not match the planned fee, so nothing was sent." };
  }
  if (fee > plan.amount) {
    return {
      ok: false,
      reason: `The fee of ${amountText(cfg, fee)} would be larger than the ${amountText(cfg, plan.amount)} being sent, so nothing was signed. Lower the fee or send more.`,
    };
  }

  const bytes = tx.extract();
  return {
    ok: true,
    hex: bytesToHex(bytes),
    txid: tx.id,
    size: cfg.script === "p2wpkh" ? tx.vsize : bytes.length,
    fee,
    change: plan.change,
    inputs: plan.inputs,
    inputTotal: plan.inputTotal,
    amount: plan.amount,
  };
}
