import { describe, it, expect } from "vitest";
import "../tonBuffer.js";
import { Address, Cell, loadMessage, loadMessageRelaxed } from "@ton/core";
import { ed25519 } from "@noble/curves/ed25519.js";
import {
  JETTON_TRANSFER_OP,
  V4R2_CODE_HASH,
  WALLET_ID,
  buildJettonTransfer,
  buildTonTransfer,
  deriveTonAccount,
  friendly,
  isTonAddress,
  jettonTransferBody,
  parseTonAddress,
  walletCode,
  walletFor,
} from "../ton";

const VECTOR = [...Array(11).fill("abandon"), "about"].join(" ");
const LIVE_PUBKEY = "fe0f1224c0ccb0fef89a00a309dd531a34fbbbe7cfb301880e6f92b6f7505ea6";
const LIVE_ADDRESS = "0:DB84D7D46BD998A0F79AA46ECBFD87F6F1273AE2CA34FCDA12CD7A0FC3B79C68";
const OTHER = Address.parse(LIVE_ADDRESS).toString({ urlSafe: true, bounceable: false });

function hexBytes(h) {
  return Uint8Array.from(h.match(/../g).map((b) => parseInt(b, 16)));
}

describe("TON wallets are the standard v4R2 contract", () => {
  it("carries the genuine v4R2 code, checked by its hash", () => {
    expect(walletCode().hash().toString("hex")).toBe(V4R2_CODE_HASH);
  });

  it("computes the same address as a real wallet on mainnet from its public key", () => {
    const { address } = walletFor(hexBytes(LIVE_PUBKEY));
    expect(address.equals(Address.parse(LIVE_ADDRESS))).toBe(true);
  });

  it("derives one stable account from the recovery phrase and shows it in the non-bounceable form", () => {
    const a = deriveTonAccount(VECTOR, "mainnet");
    expect(a.path).toBe("m/44'/607'/0'");
    expect(a.address.startsWith("UQ")).toBe(true);
    expect(deriveTonAccount(VECTOR, "testnet").address.startsWith("0Q")).toBe(true);
    expect(Address.parse(a.address).equals(walletFor(a.publicKey).address)).toBe(true);
  });

  it("reads friendly and raw addresses, and catches a typing mistake", () => {
    expect(isTonAddress(OTHER)).toBe(true);
    expect(isTonAddress(LIVE_ADDRESS)).toBe(true);
    expect(isTonAddress(OTHER.slice(0, -1) + (OTHER.endsWith("G") ? "H" : "G"))).toBe(false);
    expect(isTonAddress("0x1111111111111111111111111111111111111111")).toBe(false);
    expect(parseTonAddress(OTHER).bounceable).toBe(false);
    expect(friendly(Address.parse(LIVE_ADDRESS), "mainnet", true).startsWith("EQ")).toBe(true);
  });
});

describe("TON transfers", () => {
  const account = deriveTonAccount(VECTOR, "mainnet");

  function open(boc) {
    return loadMessage(Cell.fromBase64(boc).beginParse());
  }

  function signedBody(msg) {
    const s = msg.body.beginParse();
    const signature = s.loadBuffer(64);
    const rest = s.asCell();
    return { signature, rest, fields: rest.beginParse() };
  }

  it("deploys the wallet with its first payment, and signs what the contract will check", () => {
    const out = buildTonTransfer({ account, deployed: false, seqno: 0, to: OTHER, bounce: false, nanotons: 1000000n, now: 1700000000000 });
    const msg = open(out.boc);
    expect(msg.info.type).toBe("external-in");
    expect(msg.info.dest.equals(walletFor(account.publicKey).address)).toBe(true);
    expect(msg.init).toBeTruthy();
    expect(msg.init.code.hash().toString("hex")).toBe(V4R2_CODE_HASH);

    const { signature, rest, fields } = signedBody(msg);
    expect(ed25519.verify(signature, rest.hash(), account.publicKey)).toBe(true);
    expect(fields.loadUint(32)).toBe(WALLET_ID);
    expect(fields.loadUint(32)).toBe(1700000000 + 300);
    expect(fields.loadUint(32)).toBe(0);
    expect(fields.loadUint(8)).toBe(0);
    expect(fields.loadUint(8)).toBe(3);
    const inner = loadMessageRelaxed(fields.loadRef().beginParse());
    expect(inner.info.dest.equals(Address.parse(OTHER))).toBe(true);
    expect(inner.info.value.coins).toBe(1000000n);
    expect(inner.info.bounce).toBe(false);
  });

  it("leaves the contract code out once the wallet is deployed", () => {
    const out = buildTonTransfer({ account, deployed: true, seqno: 7, to: OTHER, bounce: true, nanotons: 5n });
    expect(open(out.boc).init).toBeFalsy();
  });

  it("refuses an undeployed wallet at any sequence number but zero", () => {
    expect(() => buildTonTransfer({ account, deployed: false, seqno: 3, to: OTHER, bounce: false, nanotons: 5n })).toThrow(/zero/);
  });

  it("lays out a jetton transfer as the standard requires, with excess coming back to the sender", () => {
    const own = walletFor(account.publicKey).address;
    const body = jettonTransferBody({ amount: 2500000n, destination: Address.parse(OTHER), responseTo: own, queryId: 9n }).beginParse();
    expect(body.loadUint(32)).toBe(JETTON_TRANSFER_OP);
    expect(body.loadUintBig(64)).toBe(9n);
    expect(body.loadCoins()).toBe(2500000n);
    expect(body.loadAddress().equals(Address.parse(OTHER))).toBe(true);
    expect(body.loadAddress().equals(own)).toBe(true);
    expect(body.loadBit()).toBe(false);
    expect(body.loadCoins()).toBe(1n);
    expect(body.loadBit()).toBe(false);
  });

  it("sends the jetton transfer to the sender's own jetton wallet, with a little TON for the fees", () => {
    const jettonWallet = "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs";
    const out = buildJettonTransfer({ account, deployed: true, seqno: 1, jettonWallet, to: OTHER, amount: 1000000n });
    const { fields } = signedBody(open(out.boc));
    fields.skip(32 + 32 + 32 + 8 + 8);
    const inner = loadMessageRelaxed(fields.loadRef().beginParse());
    expect(inner.info.dest.equals(Address.parse(jettonWallet))).toBe(true);
    expect(inner.info.value.coins).toBe(50000000n);
    expect(inner.body.beginParse().loadUint(32)).toBe(JETTON_TRANSFER_OP);
  });
});

describe("TON deposit comments", () => {
  it("carries a comment in a USDT transfer the way exchanges read it", () => {
    const own = walletFor(deriveTonAccount(VECTOR).publicKey).address;
    const body = jettonTransferBody({ amount: 1n, destination: own, responseTo: own, memo: "deposit 4471", queryId: 1n }).beginParse();
    body.skip(32 + 64);
    body.loadCoins();
    body.loadAddress();
    body.loadAddress();
    body.loadBit();
    expect(body.loadCoins()).toBe(1n);
    expect(body.loadBit()).toBe(true);
    const memo = body.loadRef().beginParse();
    expect(memo.loadUint(32)).toBe(0);
    expect(memo.loadStringTail()).toBe("deposit 4471");
  });
});
