import { ed25519 } from "@noble/curves/ed25519.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256, sha512 } from "@noble/hashes/sha2.js";
import { base58, base64 } from "@scure/base";
import * as bip39 from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";

export const SOLANA_PATH = "m/44'/501'/0'/0'";
export const LAMPORTS_PER_SOL = 1000000000n;

export const SYSTEM_PROGRAM = "11111111111111111111111111111111";
export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
export const COMPUTE_BUDGET_PROGRAM = "ComputeBudget111111111111111111111111111111";

export const SOLANA_TOKENS = Object.freeze({
  mainnet: [
    { symbol: "USDC", name: "USD Coin", mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6 },
    { symbol: "USDT", name: "Tether USD", mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", decimals: 6 },
  ],
  devnet: [{ symbol: "USDC", name: "USD Coin (devnet)", mint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", decimals: 6 }],
});

const HARDENED = 0x80000000;
const ENCODER = new TextEncoder();

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

function u32be(n) {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, n >>> 0, false);
  return out;
}

function u32le(n) {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, n >>> 0, true);
  return out;
}

function u64le(value) {
  const v = BigInt(value);
  if (v < 0n || v > 0xffffffffffffffffn) throw new Error("That amount is out of range.");
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, v, true);
  return out;
}

export function slip10Ed25519(seed, path) {
  if (!/^m(\/\d+')*$/.test(path)) throw new Error("Solana keys use a fully hardened path.");
  let I = hmac(sha512, ENCODER.encode("ed25519 seed"), seed);
  let key = I.slice(0, 32);
  let chain = I.slice(32);
  for (const part of path.split("/").slice(1)) {
    const index = (Number(part.slice(0, -1)) + HARDENED) >>> 0;
    I = hmac(sha512, chain, concat(new Uint8Array([0]), key, u32be(index)));
    key = I.slice(0, 32);
    chain = I.slice(32);
  }
  return { key, chainCode: chain };
}

export function deriveSolanaAccount(phrase, path = SOLANA_PATH) {
  const words = String(phrase || "").trim().toLowerCase().split(/\s+/).join(" ");
  if (!words) throw new Error("This wallet has no recovery phrase, so a Solana account cannot be derived from it.");
  if (!bip39.validateMnemonic(words, wordlist)) throw new Error("That recovery phrase is not valid.");
  const { key } = slip10Ed25519(bip39.mnemonicToSeedSync(words), path);
  const publicKey = ed25519.getPublicKey(key);
  return { address: base58.encode(publicKey), publicKey, secret: key, path };
}

export function pubkeyBytes(address) {
  let bytes;
  try {
    bytes = base58.decode(String(address || "").trim());
  } catch {
    throw new Error("That is not a Solana address.");
  }
  if (bytes.length !== 32) throw new Error("That is not a Solana address.");
  return bytes;
}

export function isSolanaAddress(address) {
  try {
    pubkeyBytes(address);
    return true;
  } catch {
    return false;
  }
}

export function isOnCurve(bytes) {
  try {
    ed25519.Point.fromBytes(bytes);
    return true;
  } catch {
    return false;
  }
}

export function findProgramAddress(seeds, programId) {
  const program = pubkeyBytes(programId);
  for (let bump = 255; bump >= 0; bump--) {
    const hash = sha256(concat(...seeds, new Uint8Array([bump]), program, ENCODER.encode("ProgramDerivedAddress")));
    if (!isOnCurve(hash)) return { address: base58.encode(hash), bump };
  }
  throw new Error("No program address could be found for these seeds.");
}

export function associatedTokenAddress(owner, mint, tokenProgram = TOKEN_PROGRAM) {
  return findProgramAddress([pubkeyBytes(owner), pubkeyBytes(tokenProgram), pubkeyBytes(mint)], ATA_PROGRAM).address;
}

function compactU16(n) {
  const out = [];
  let v = n;
  for (;;) {
    let byte = v & 0x7f;
    v >>= 7;
    if (v === 0) {
      out.push(byte);
      return Uint8Array.from(out);
    }
    byte |= 0x80;
    out.push(byte);
  }
}

export function transferSolInstruction(from, to, lamports) {
  return {
    programId: SYSTEM_PROGRAM,
    keys: [
      { pubkey: from, signer: true, writable: true },
      { pubkey: to, signer: false, writable: true },
    ],
    data: concat(u32le(2), u64le(lamports)),
  };
}

export function createAtaIdempotentInstruction(payer, ata, owner, mint, tokenProgram = TOKEN_PROGRAM) {
  return {
    programId: ATA_PROGRAM,
    keys: [
      { pubkey: payer, signer: true, writable: true },
      { pubkey: ata, signer: false, writable: true },
      { pubkey: owner, signer: false, writable: false },
      { pubkey: mint, signer: false, writable: false },
      { pubkey: SYSTEM_PROGRAM, signer: false, writable: false },
      { pubkey: tokenProgram, signer: false, writable: false },
    ],
    data: Uint8Array.from([1]),
  };
}

export function transferCheckedInstruction(source, mint, destination, owner, amount, decimals, tokenProgram = TOKEN_PROGRAM) {
  return {
    programId: tokenProgram,
    keys: [
      { pubkey: source, signer: false, writable: true },
      { pubkey: mint, signer: false, writable: false },
      { pubkey: destination, signer: false, writable: true },
      { pubkey: owner, signer: true, writable: false },
    ],
    data: concat(Uint8Array.from([12]), u64le(amount), Uint8Array.from([decimals])),
  };
}

export function computeUnitPriceInstruction(microLamports) {
  return { programId: COMPUTE_BUDGET_PROGRAM, keys: [], data: concat(Uint8Array.from([3]), u64le(microLamports)) };
}

export function computeUnitLimitInstruction(units) {
  return { programId: COMPUTE_BUDGET_PROGRAM, keys: [], data: concat(Uint8Array.from([2]), u32le(units)) };
}

export function compileMessage({ payer, instructions, recentBlockhash }) {
  const metas = new Map();
  const touch = (pubkey, signer, writable) => {
    const prev = metas.get(pubkey) || { pubkey, signer: false, writable: false };
    metas.set(pubkey, { pubkey, signer: prev.signer || signer, writable: prev.writable || writable });
  };
  touch(payer, true, true);
  for (const ix of instructions) {
    for (const k of ix.keys) touch(k.pubkey, k.signer, k.writable);
    touch(ix.programId, false, false);
  }
  const all = [...metas.values()];
  const rank = (m) => (m.signer ? (m.writable ? 0 : 1) : m.writable ? 2 : 3);
  const ordered = [all.find((m) => m.pubkey === payer), ...all.filter((m) => m.pubkey !== payer).sort((a, b) => rank(a) - rank(b))];
  const index = new Map(ordered.map((m, i) => [m.pubkey, i]));

  const numSigners = ordered.filter((m) => m.signer).length;
  const header = Uint8Array.from([
    numSigners,
    ordered.filter((m) => m.signer && !m.writable).length,
    ordered.filter((m) => !m.signer && !m.writable).length,
  ]);
  const keys = concat(compactU16(ordered.length), ...ordered.map((m) => pubkeyBytes(m.pubkey)));
  const blockhash = pubkeyBytes(recentBlockhash);
  const ixBytes = instructions.map((ix) =>
    concat(
      Uint8Array.from([index.get(ix.programId)]),
      compactU16(ix.keys.length),
      Uint8Array.from(ix.keys.map((k) => index.get(k.pubkey))),
      compactU16(ix.data.length),
      ix.data
    )
  );
  const message = concat(header, keys, blockhash, compactU16(instructions.length), ...ixBytes);
  return { message, signers: ordered.slice(0, numSigners).map((m) => m.pubkey), accounts: ordered };
}

export function signMessage(message, secret, signerAddress) {
  const publicKey = ed25519.getPublicKey(secret);
  if (base58.encode(publicKey) !== signerAddress) throw new Error("The signing key does not match the sending address.");
  const signature = ed25519.sign(message, secret);
  const wire = concat(compactU16(1), signature, message);
  return { signature: base58.encode(signature), base64: base64.encode(wire) };
}

export function buildSolTransfer({ from, to, lamports, recentBlockhash, secret, priorityMicroLamports = 0 }) {
  const instructions = [];
  if (priorityMicroLamports > 0) instructions.push(computeUnitPriceInstruction(priorityMicroLamports));
  instructions.push(transferSolInstruction(from, to, lamports));
  const { message, signers } = compileMessage({ payer: from, instructions, recentBlockhash });
  if (signers.length !== 1) throw new Error("A transfer has exactly one signer.");
  return signMessage(message, secret, from);
}

export function buildTokenTransfer({ owner, to, mint, decimals, amount, recentBlockhash, secret, createRecipientAccount, priorityMicroLamports = 0 }) {
  const source = associatedTokenAddress(owner, mint);
  const destination = associatedTokenAddress(to, mint);
  const instructions = [];
  if (priorityMicroLamports > 0) instructions.push(computeUnitPriceInstruction(priorityMicroLamports));
  if (createRecipientAccount) instructions.push(createAtaIdempotentInstruction(owner, destination, to, mint));
  instructions.push(transferCheckedInstruction(source, mint, destination, owner, amount, decimals));
  const { message, signers } = compileMessage({ payer: owner, instructions, recentBlockhash });
  if (signers.length !== 1) throw new Error("A transfer has exactly one signer.");
  return { ...signMessage(message, secret, owner), source, destination };
}
