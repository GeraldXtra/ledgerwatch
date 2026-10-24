import "./tonBuffer.js";
import { Buffer } from "buffer";
import { Address, Cell, beginCell, comment, contractAddress, external, internal, storeMessage, storeMessageRelaxed, toNano } from "@ton/core";
import { ed25519 } from "@noble/curves/ed25519.js";
import * as bip39 from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { slip10Ed25519 } from "../solana/solana.js";

export const TON_PATH = "m/44'/607'/0'";
export const WALLET_ID = 698983191;
export const V4R2_CODE_HASH = "feb5ff6820e2ff0d9483e7e0d62c817d846789fb4ae580c878866d959dabd5c0";
const V4R2_CODE =
  "te6cckECFAEAAtQAART/APSkE/S88sgLAQIBIAIDAgFIBAUE+PKDCNcYINMf0x/THwL4I7vyZO1E0NMf0x/T//QE0VFDuvKhUVG68qIF+QFUEGT5EPKj+AAkpMjLH1JAyx9SMMv/UhD0AMntVPgPAdMHIcAAn2xRkyDXSpbTB9QC+wDoMOAhwAHjACHAAuMAAcADkTDjDQOkyMsfEssfy/8QERITAubQAdDTAyFxsJJfBOAi10nBIJJfBOAC0x8hghBwbHVnvSKCEGRzdHK9sJJfBeAD+kAwIPpEAcjKB8v/ydDtRNCBAUDXIfQEMFyBAQj0Cm+hMbOSXwfgBdM/yCWCEHBsdWe6kjgw4w0DghBkc3RyupJfBuMNBgcCASAICQB4AfoA9AQw+CdvIjBQCqEhvvLgUIIQcGx1Z4MesXCAGFAEywUmzxZY+gIZ9ADLaRfLH1Jgyz8gyYBA+wAGAIpQBIEBCPRZMO1E0IEBQNcgyAHPFvQAye1UAXKwjiOCEGRzdHKDHrFwgBhQBcsFUAPPFiP6AhPLassfyz/JgED7AJJfA+ICASAKCwBZvSQrb2omhAgKBrkPoCGEcNQICEekk30pkQzmkD6f+YN4EoAbeBAUiYcVnzGEAgFYDA0AEbjJftRNDXCx+AA9sp37UTQgQFA1yH0BDACyMoHy//J0AGBAQj0Cm+hMYAIBIA4PABmtznaiaEAga5Drhf/AABmvHfaiaEAQa5DrhY/AAG7SB/oA1NQi+QAFyMoHFcv/ydB3dIAYyMsFywIizxZQBfoCFMtrEszMyXP7AMhAFIEBCPRR8qcCAHCBAQjXGPoA0z/IVCBHgQEI9FHyp4IQbm90ZXB0gBjIywXLAlAGzxZQBPoCFMtqEssfyz/Jc/sAAgBsgQEI1xj6ANM/MFIkgQEI9Fnyp4IQZHN0cnB0gBjIywXLAlAFzxZQA/oCE8tqyx8Syz/Jc/sAAAr0AMntVGliJeU=";

export const JETTON_TRANSFER_OP = 0x0f8a7ea5;
export const JETTON_FORWARD_TON = toNano("0.05");
export const SEND_MODE = 3;
const MAX_VALID_SECONDS = 300;

let codeCell = null;

export function walletCode() {
  if (!codeCell) {
    const cell = Cell.fromBase64(V4R2_CODE);
    if (cell.hash().toString("hex") !== V4R2_CODE_HASH) throw new Error("The wallet contract code failed its integrity check.");
    codeCell = cell;
  }
  return codeCell;
}

export function walletData(publicKey) {
  return beginCell().storeUint(0, 32).storeUint(WALLET_ID, 32).storeBuffer(Buffer.from(publicKey)).storeBit(0).endCell();
}

export function walletFor(publicKey) {
  const init = { code: walletCode(), data: walletData(publicKey) };
  return { address: contractAddress(0, init), init };
}

export function friendly(address, network, bounceable = false) {
  return address.toString({ urlSafe: true, bounceable, testOnly: network === "testnet" });
}

export function deriveTonAccount(phrase, network = "mainnet") {
  const words = String(phrase || "").trim().toLowerCase().split(/\s+/).join(" ");
  if (!words) throw new Error("This wallet has no recovery phrase, so a TON account cannot be derived from it.");
  if (!bip39.validateMnemonic(words, wordlist)) throw new Error("That recovery phrase is not valid.");
  const { key } = slip10Ed25519(bip39.mnemonicToSeedSync(words), TON_PATH);
  const publicKey = ed25519.getPublicKey(key);
  const { address, init } = walletFor(publicKey);
  return { address: friendly(address, network), raw: address.toRawString(), publicKey, secret: key, init, path: TON_PATH };
}

export function parseTonAddress(text) {
  const s = String(text || "").trim();
  if (!s) throw new Error("Enter the address to send to.");
  try {
    if (Address.isFriendly(s)) {
      const parsed = Address.parseFriendly(s);
      return { address: parsed.address, bounceable: parsed.isBounceable, testOnly: parsed.isTestOnly };
    }
    if (Address.isRaw(s)) return { address: Address.parseRaw(s), bounceable: true, testOnly: false };
  } catch {
    throw new Error("That TON address has a typing mistake in it: its checksum does not match.");
  }
  throw new Error("That is not a TON address.");
}

export function isTonAddress(text) {
  try {
    parseTonAddress(text);
    return true;
  } catch {
    return false;
  }
}

export function jettonTransferBody({ amount, destination, responseTo, forwardTon = 1n, memo, queryId = BigInt(Date.now()) }) {
  const b = beginCell()
    .storeUint(JETTON_TRANSFER_OP, 32)
    .storeUint(queryId, 64)
    .storeCoins(amount)
    .storeAddress(destination)
    .storeAddress(responseTo)
    .storeBit(0)
    .storeCoins(forwardTon);
  if (memo) b.storeBit(1).storeRef(comment(String(memo).slice(0, 120)));
  else b.storeBit(0);
  return b.endCell();
}

function signedTransfer({ seqno, validUntil, message, secret }) {
  const body = beginCell()
    .storeUint(WALLET_ID, 32)
    .storeUint(validUntil, 32)
    .storeUint(seqno, 32)
    .storeUint(0, 8)
    .storeUint(SEND_MODE, 8)
    .storeRef(beginCell().store(storeMessageRelaxed(message)).endCell())
    .endCell();
  const signature = ed25519.sign(body.hash(), secret);
  return beginCell().storeBuffer(Buffer.from(signature)).storeBuilder(body.asBuilder()).endCell();
}

function externalFor({ account, deployed, body }) {
  const { address, init } = walletFor(account.publicKey);
  const msg = external({ to: address, init: deployed ? undefined : init, body });
  const cell = beginCell().store(storeMessage(msg)).endCell();
  return { boc: cell.toBoc().toString("base64"), hash: cell.hash().toString("hex") };
}

function validUntilFrom(now) {
  return Math.floor(now / 1000) + MAX_VALID_SECONDS;
}

export function buildTonTransfer({ account, deployed, seqno, to, bounce, nanotons, memo, now = Date.now() }) {
  if (!deployed && seqno !== 0) throw new Error("A wallet that is not deployed yet must start at sequence number zero.");
  const destination = typeof to === "string" ? parseTonAddress(to).address : to;
  const message = internal({ to: destination, value: BigInt(nanotons), bounce: Boolean(bounce), body: memo ? comment(String(memo).slice(0, 120)) : undefined });
  const body = signedTransfer({ seqno, validUntil: validUntilFrom(now), message, secret: account.secret });
  return externalFor({ account, deployed, body });
}

export function buildJettonTransfer({ account, deployed, seqno, jettonWallet, to, amount, memo, now = Date.now() }) {
  const { address: own } = walletFor(account.publicKey);
  const payload = jettonTransferBody({ amount: BigInt(amount), destination: parseTonAddress(to).address, responseTo: own, memo });
  const message = internal({ to: parseTonAddress(jettonWallet).address, value: JETTON_FORWARD_TON, bounce: true, body: payload });
  const body = signedTransfer({ seqno, validUntil: validUntilFrom(now), message, secret: account.secret });
  return externalFor({ account, deployed, body });
}
