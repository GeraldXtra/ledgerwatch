import { HDNodeWallet, SigningKey, computeAddress, decodeBase58, encodeBase58, getBytes, hexlify, sha256 } from "ethers";

export const TRON_PATH = "m/44'/195'/0'/0/0";
export const SUN_PER_TRX = 1000000n;
export const TRON_PREFIX = 0x41;

const TRANSFER_TYPE = 1;
const TRIGGER_TYPE = 31;
const TRANSFER_URL = "type.googleapis.com/protocol.TransferContract";
const TRIGGER_URL = "type.googleapis.com/protocol.TriggerSmartContract";

function concat(...parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function sha256Bytes(bytes) {
  return getBytes(sha256(bytes));
}

export function tronAddressFromHex(hex21) {
  const body = getBytes(hex21);
  if (body.length !== 21 || body[0] !== TRON_PREFIX) throw new Error("A Tron address is 21 bytes starting 0x41.");
  const check = sha256Bytes(sha256Bytes(body)).slice(0, 4);
  return encodeBase58(concat(body, check));
}

export function tronAddressBytes(address) {
  const s = String(address || "").trim();
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(s)) throw new Error("A Tron address starts with T and is 34 characters long.");
  const raw = getBytes(toFixed(decodeBase58(s), 25));
  const body = raw.slice(0, 21);
  const check = raw.slice(21);
  const expected = sha256Bytes(sha256Bytes(body)).slice(0, 4);
  if (body[0] !== TRON_PREFIX || check.some((b, i) => b !== expected[i])) {
    throw new Error("That Tron address has a typing mistake in it: its checksum does not match.");
  }
  return body;
}

function toFixed(big, length) {
  const hex = big.toString(16).padStart(length * 2, "0");
  if (hex.length > length * 2) throw new Error("That Tron address is too long.");
  return `0x${hex}`;
}

export function isTronAddress(address) {
  try {
    tronAddressBytes(address);
    return true;
  } catch {
    return false;
  }
}

export function deriveTronAccount(phrase) {
  if (typeof phrase !== "string" || !phrase.trim()) {
    throw new Error("This wallet has no recovery phrase, so a Tron account cannot be derived from it.");
  }
  const node = HDNodeWallet.fromPhrase(phrase.trim(), "", TRON_PATH);
  const evm = computeAddress(node.publicKey);
  return { address: tronAddressFromHex(`0x41${evm.slice(2)}`), path: TRON_PATH, privateKey: node.privateKey };
}

function varint(value) {
  let v = BigInt(value);
  if (v < 0n) throw new Error("Negative values are not encoded.");
  const out = [];
  do {
    let byte = Number(v & 0x7fn);
    v >>= 7n;
    if (v > 0n) byte |= 0x80;
    out.push(byte);
  } while (v > 0n);
  return Uint8Array.from(out);
}

function key(field, wire) {
  return varint((field << 3) | wire);
}

function bytesField(field, bytes) {
  return concat(key(field, 2), varint(bytes.length), bytes);
}

function intField(field, value) {
  return concat(key(field, 0), varint(value));
}

function text(s) {
  return new TextEncoder().encode(s);
}

function contractBytes(type, url, value) {
  const any = concat(bytesField(1, text(url)), bytesField(2, value));
  return concat(intField(1, type), bytesField(2, any));
}

function transferValue({ owner, to, amount }) {
  return concat(bytesField(1, tronAddressBytes(owner)), bytesField(2, tronAddressBytes(to)), intField(3, amount));
}

function triggerValue({ owner, contract, data, callValue = 0n }) {
  const parts = [bytesField(1, tronAddressBytes(owner)), bytesField(2, tronAddressBytes(contract))];
  if (BigInt(callValue) > 0n) parts.push(intField(3, callValue));
  parts.push(bytesField(4, getBytes(data)));
  return concat(...parts);
}

export function encodeRaw({ refBlockBytes, refBlockHash, expiration, timestamp, feeLimit, contract }) {
  const parts = [
    bytesField(1, getBytes(`0x${refBlockBytes}`)),
    bytesField(4, getBytes(`0x${refBlockHash}`)),
    intField(8, expiration),
  ];
  if (contract.kind === "transfer") {
    parts.push(bytesField(11, contractBytes(TRANSFER_TYPE, TRANSFER_URL, transferValue(contract))));
  } else if (contract.kind === "trigger") {
    parts.push(bytesField(11, contractBytes(TRIGGER_TYPE, TRIGGER_URL, triggerValue(contract))));
  } else {
    throw new Error("Unknown Tron contract kind.");
  }
  parts.push(intField(14, timestamp));
  if (feeLimit != null) parts.push(intField(18, feeLimit));
  return concat(...parts);
}

export function txIdOf(raw) {
  return sha256(raw).slice(2);
}

export function trc20TransferData(to, amount) {
  const body = tronAddressBytes(to).slice(1);
  const addr = hexlify(body).slice(2).padStart(64, "0");
  const value = BigInt(amount).toString(16).padStart(64, "0");
  if (value.length > 64) throw new Error("That amount is too large.");
  return `0xa9059cbb${addr}${value}`;
}

export function refFromBlock(block) {
  const header = block && block.block_header && block.block_header.raw_data;
  const id = String((block && block.blockID) || "");
  if (!header || !/^[0-9a-f]{64}$/.test(id)) throw new Error("The latest Tron block could not be read.");
  const number = BigInt(header.number);
  return {
    refBlockBytes: (number & 0xffffn).toString(16).padStart(4, "0"),
    refBlockHash: id.slice(16, 32),
    timestamp: Number(header.timestamp),
  };
}

export function signRaw(raw, privateKey) {
  const id = sha256(raw);
  const sig = new SigningKey(privateKey).sign(id);
  const signature = getBytes(`${sig.r}${sig.s.slice(2)}${sig.v.toString(16).padStart(2, "0")}`);
  const signed = concat(bytesField(1, raw), bytesField(2, signature));
  return { txid: id.slice(2), hex: hexlify(signed).slice(2), signature: hexlify(signature).slice(2) };
}

export function buildTronTransfer({ block, owner, to, amountSun, privateKey, now = Date.now(), lifetimeMs = 60000 }) {
  const ref = refFromBlock(block);
  const raw = encodeRaw({
    ...ref,
    timestamp: now,
    expiration: Math.max(ref.timestamp, now) + lifetimeMs,
    contract: { kind: "transfer", owner, to, amount: BigInt(amountSun) },
  });
  return { raw, ...signRaw(raw, privateKey) };
}

export function buildTrc20Transfer({ block, owner, token, to, amount, feeLimit, privateKey, now = Date.now(), lifetimeMs = 60000 }) {
  const ref = refFromBlock(block);
  const raw = encodeRaw({
    ...ref,
    timestamp: now,
    expiration: Math.max(ref.timestamp, now) + lifetimeMs,
    feeLimit,
    contract: { kind: "trigger", owner, contract: token, data: trc20TransferData(to, amount) },
  });
  return { raw, ...signRaw(raw, privateKey) };
}
