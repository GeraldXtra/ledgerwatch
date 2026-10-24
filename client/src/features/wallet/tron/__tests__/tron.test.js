import { describe, it, expect } from "vitest";
import { SigningKey, Wallet, getBytes, hexlify, recoverAddress, sha256 } from "ethers";
import {
  buildTronTransfer,
  deriveTronAccount,
  encodeRaw,
  isTronAddress,
  refFromBlock,
  signRaw,
  trc20TransferData,
  tronAddressBytes,
  tronAddressFromHex,
  txIdOf,
} from "../tron";

const VECTOR = [...Array(11).fill("abandon"), "about"].join(" ");
const OWNER = "TKHuVq1oKVruCGLvqVexFs6dawKv6fQgFs";
const USDT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

const NODE_TRANSFER = {
  raw: { ref_block_bytes: "7938", ref_block_hash: "15e6b88a7b349dbb", expiration: 1792844868000, timestamp: 1792844809556 },
  hex: "0a027938220815e6b88a7b349dbb40a0d386ef96345a67080112630a2d747970652e676f6f676c65617069732e636f6d2f70726f746f636f6c2e5472616e73666572436f6e747261637412320a154166426c7ac3d98b29191063833345b6bc540d7278121541a614f803b6fd780986a42c78ec9c7f77e6ded13c18c0843d70d48a83ef9634",
  txID: "9f6994229f06d9ac14090294c6598005600d4155ed05d29194c2982888c82613",
};

const NODE_TRC20 = {
  raw: { ref_block_bytes: "7938", ref_block_hash: "15e6b88a7b349dbb", expiration: 1792844868000, timestamp: 1792844810606, fee_limit: 30000000 },
  data: "0xa9059cbb0000000000000000000000008a40ec5c7cd1bc8f5b1e2f3a0c8ff5d4cd33b1aa00000000000000000000000000000000000000000000000000000000000f4240",
  hex: "0a027938220815e6b88a7b349dbb40a0d386ef96345aae01081f12a9010a31747970652e676f6f676c65617069732e636f6d2f70726f746f636f6c2e54726967676572536d617274436f6e747261637412740a154166426c7ac3d98b29191063833345b6bc540d7278121541a614f803b6fd780986a42c78ec9c7f77e6ded13c2244a9059cbb0000000000000000000000008a40ec5c7cd1bc8f5b1e2f3a0c8ff5d4cd33b1aa00000000000000000000000000000000000000000000000000000000000f424070ee9283ef963490018087a70e",
  txID: "52ce54ae359e07aff3f99cda3fcb2d883739c9487daf2612b5efe64a2666ced8",
};

describe("Tron addresses", () => {
  it("derives the published test vector address from the same recovery phrase", () => {
    expect(deriveTronAccount(VECTOR).address).toBe("TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH");
  });

  it("round-trips an address through its bytes", () => {
    const bytes = tronAddressBytes(USDT);
    expect(bytes.length).toBe(21);
    expect(bytes[0]).toBe(0x41);
    expect(tronAddressFromHex(hexlify(bytes))).toBe(USDT);
  });

  it("catches a typing mistake by its checksum", () => {
    const typo = USDT.slice(0, -1) + (USDT.endsWith("t") ? "u" : "t");
    expect(isTronAddress(USDT)).toBe(true);
    expect(isTronAddress(typo)).toBe(false);
    expect(isTronAddress("0x1111111111111111111111111111111111111111")).toBe(false);
  });
});

describe("Tron transactions are built here, byte for byte the same as the network builds them", () => {
  it("encodes a TRX transfer exactly as the node does", () => {
    const raw = encodeRaw({
      refBlockBytes: NODE_TRANSFER.raw.ref_block_bytes,
      refBlockHash: NODE_TRANSFER.raw.ref_block_hash,
      expiration: NODE_TRANSFER.raw.expiration,
      timestamp: NODE_TRANSFER.raw.timestamp,
      contract: { kind: "transfer", owner: OWNER, to: USDT, amount: 1000000n },
    });
    expect(hexlify(raw).slice(2)).toBe(NODE_TRANSFER.hex);
    expect(txIdOf(raw)).toBe(NODE_TRANSFER.txID);
  });

  it("encodes a USDT transfer exactly as the node does", () => {
    const raw = encodeRaw({
      refBlockBytes: NODE_TRC20.raw.ref_block_bytes,
      refBlockHash: NODE_TRC20.raw.ref_block_hash,
      expiration: NODE_TRC20.raw.expiration,
      timestamp: NODE_TRC20.raw.timestamp,
      feeLimit: NODE_TRC20.raw.fee_limit,
      contract: { kind: "trigger", owner: OWNER, contract: USDT, data: NODE_TRC20.data },
    });
    expect(hexlify(raw).slice(2)).toBe(NODE_TRC20.hex);
    expect(txIdOf(raw)).toBe(NODE_TRC20.txID);
  });

  it("encodes the token transfer call with the recipient and amount where the contract reads them", () => {
    const to = tronAddressFromHex("0x418a40ec5c7cd1bc8f5b1e2f3a0c8ff5d4cd33b1aa");
    expect(trc20TransferData(to, 1000000n)).toBe(NODE_TRC20.data);
  });

  it("takes the reference block the way the network expects", () => {
    const ref = refFromBlock({
      blockID: "00000000053577e33c730086cb3007795da4e955e834dcf01df6287b0c275904",
      block_header: { raw_data: { number: 87390179, timestamp: 1792844800000 } },
    });
    expect(ref).toEqual({ refBlockBytes: "77e3", refBlockHash: "3c730086cb300779", timestamp: 1792844800000 });
  });

  it("signs the transaction id so the signer can be recovered as the owner", () => {
    const wallet = Wallet.createRandom();
    const raw = getBytes("0x0a02793822080000000000000000");
    const { txid, signature, hex } = signRaw(raw, wallet.privateKey);
    expect(txid).toBe(sha256(raw).slice(2));
    expect(signature).toHaveLength(130);
    const v = parseInt(signature.slice(128), 16);
    expect([27, 28]).toContain(v);
    expect(recoverAddress(`0x${txid}`, `0x${signature}`)).toBe(wallet.address);
    expect(hex.startsWith(`0a${raw.length.toString(16).padStart(2, "0")}`)).toBe(true);
    expect(hex.endsWith(`1241${signature}`)).toBe(true);
    expect(new SigningKey(wallet.privateKey).publicKey).toBeTruthy();
  });

  it("builds a signed transfer that expires a minute after it is made", () => {
    const account = deriveTronAccount(VECTOR);
    const block = { blockID: "00000000053577e33c730086cb3007795da4e955e834dcf01df6287b0c275904", block_header: { raw_data: { number: 87390179, timestamp: 1000 } } };
    const out = buildTronTransfer({ block, owner: account.address, to: USDT, amountSun: 5n, privateKey: account.privateKey, now: 2000 });
    expect(out.txid).toBe(txIdOf(out.raw));
    const expected = encodeRaw({ refBlockBytes: "77e3", refBlockHash: "3c730086cb300779", timestamp: 2000, expiration: 62000, contract: { kind: "transfer", owner: account.address, to: USDT, amount: 5n } });
    expect(hexlify(out.raw)).toBe(hexlify(expected));
  });
});
