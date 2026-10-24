import { describe, it, expect } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import { base58, base64, hex } from "@scure/base";
import {
  ATA_PROGRAM,
  SYSTEM_PROGRAM,
  TOKEN_PROGRAM,
  associatedTokenAddress,
  buildSolTransfer,
  buildTokenTransfer,
  compileMessage,
  createAtaIdempotentInstruction,
  deriveSolanaAccount,
  isSolanaAddress,
  slip10Ed25519,
  transferCheckedInstruction,
  transferSolInstruction,
} from "../solana";

const VECTOR = [...Array(11).fill("abandon"), "about"].join(" ");
const SEED = hex.decode("000102030405060708090a0b0c0d0e0f");
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const BLOCKHASH = "EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N";

function keyOf(secret) {
  return base58.encode(ed25519.getPublicKey(secret));
}

describe("Solana keys follow SLIP-0010, the standard every Solana wallet uses", () => {
  it("matches the published SLIP-0010 ed25519 test vector", () => {
    expect(hex.encode(slip10Ed25519(SEED, "m").key)).toBe("2b4be7f19ee27bbf30c667b642d5f4aa69fd169872f8fc3059c08ebae2eb19e7");
    expect(hex.encode(slip10Ed25519(SEED, "m").chainCode)).toBe("90046a93de5380a72b5e45010748567d5ea02bbf6522f979e05c0d8d8ca9fffb");
    const child = slip10Ed25519(SEED, "m/0'");
    expect(hex.encode(child.key)).toBe("68e0fe46dfb67e368c75379acec591dad19df3cde26e63b93a8e704f1dade7a3");
    expect(hex.encode(ed25519.getPublicKey(child.key))).toBe("8c8a13df77a28f3445213a0f432fde644acaa215fc72dcdf300d5efaa85d350c");
    expect(hex.encode(slip10Ed25519(SEED, "m/0'/1'").key)).toBe("b1d0bad404bf35da785a64ca1ac54b2617211d2777696fbffaf208f746ae84f2");
  });

  it("refuses a path with a non-hardened step, which ed25519 cannot derive", () => {
    expect(() => slip10Ed25519(SEED, "m/44'/501'/0'/0")).toThrow(/hardened/);
  });

  it("derives one stable address on the Phantom path from the recovery phrase", () => {
    const a = deriveSolanaAccount(VECTOR);
    expect(a.path).toBe("m/44'/501'/0'/0'");
    expect(isSolanaAddress(a.address)).toBe(true);
    expect(deriveSolanaAccount(VECTOR).address).toBe(a.address);
    expect(keyOf(a.secret)).toBe(a.address);
  });

  it("checks addresses", () => {
    expect(isSolanaAddress(USDC)).toBe(true);
    expect(isSolanaAddress("0x1111111111111111111111111111111111111111")).toBe(false);
    expect(isSolanaAddress(USDC.slice(0, -2))).toBe(false);
  });
});

describe("Solana transactions are laid out the way the runtime reads them", () => {
  it("encodes a SOL transfer as instruction 2 with the lamports in little-endian", () => {
    const ix = transferSolInstruction(SYSTEM_PROGRAM, USDC, 1000000n);
    expect(hex.encode(ix.data)).toBe("0200000040420f0000000000");
  });

  it("encodes a checked token transfer as instruction 12 with amount and decimals", () => {
    const ix = transferCheckedInstruction(USDC, USDC, USDC, USDC, 2500000n, 6);
    expect(hex.encode(ix.data)).toBe("0ca025260000000000" + "06");
    expect(ix.programId).toBe(TOKEN_PROGRAM);
    expect(ix.keys.map((k) => [k.signer, k.writable])).toEqual([
      [false, true],
      [false, false],
      [false, true],
      [true, false],
    ]);
  });

  it("creates the recipient's token account only if it is missing, paid by the sender", () => {
    const ix = createAtaIdempotentInstruction("a", "b", "c", "d");
    expect(Array.from(ix.data)).toEqual([1]);
    expect(ix.programId).toBe(ATA_PROGRAM);
    expect(ix.keys[0]).toMatchObject({ pubkey: "a", signer: true, writable: true });
  });

  it("orders accounts fee payer first, then writable, then read-only, with a correct header", () => {
    const payer = keyOf(new Uint8Array(32).fill(1));
    const to = keyOf(new Uint8Array(32).fill(2));
    const { message, accounts } = compileMessage({ payer, instructions: [transferSolInstruction(payer, to, 5n)], recentBlockhash: BLOCKHASH });
    expect(accounts.map((a) => a.pubkey)).toEqual([payer, to, SYSTEM_PROGRAM]);
    expect(Array.from(message.slice(0, 4))).toEqual([1, 0, 1, 3]);
    expect(base58.encode(message.slice(4 + 96, 4 + 128))).toBe(BLOCKHASH);
  });

  it("signs a transfer the sender's key verifies, and refuses a key that is not the sender's", () => {
    const secret = new Uint8Array(32).fill(9);
    const from = keyOf(secret);
    const to = keyOf(new Uint8Array(32).fill(3));
    const tx = buildSolTransfer({ from, to, lamports: 1n, recentBlockhash: BLOCKHASH, secret });
    const wire = base64.decode(tx.base64);
    expect(wire[0]).toBe(1);
    expect(ed25519.verify(wire.slice(1, 65), wire.slice(65), ed25519.getPublicKey(secret))).toBe(true);
    expect(() => buildSolTransfer({ from: to, to: from, lamports: 1n, recentBlockhash: BLOCKHASH, secret })).toThrow(/does not match/);
  });

  it("moves tokens between the two owners' token accounts", () => {
    const secret = new Uint8Array(32).fill(4);
    const owner = keyOf(secret);
    const to = keyOf(new Uint8Array(32).fill(5));
    const out = buildTokenTransfer({ owner, to, mint: USDC, decimals: 6, amount: 1n, recentBlockhash: BLOCKHASH, secret, createRecipientAccount: true });
    expect(out.source).toBe(associatedTokenAddress(owner, USDC));
    expect(out.destination).toBe(associatedTokenAddress(to, USDC));
    expect(out.source).not.toBe(out.destination);
  });
});
