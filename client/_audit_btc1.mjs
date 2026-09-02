import { HDKey } from "@scure/bip32";
import * as bip39 from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import * as btc from "@scure/btc-signer";
import { bech32 } from "@scure/base";
import { ripemd160 } from "@noble/hashes/ripemd160";
import { sha256 } from "@noble/hashes/sha256";

import { deriveBitcoinAccount, deriveBitcoinPrivateKey, networkParams } from "./src/features/wallet/bitcoin/derivation.js";
import { estimateVsize, estimateFee, selectUtxos, buildP2wpkhSpend, DUST_LIMIT_SATS } from "./src/features/wallet/bitcoin/tx.js";

const M = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const hex = (b) => Buffer.from(b).toString("hex");

// ---- INDEPENDENT bech32 P2WPKH encoder (does NOT use btc.p2wpkh) ----
function indepP2wpkh(pubkey, hrp) {
  const h160 = ripemd160(sha256(pubkey));
  const words = bech32.toWords(h160);
  return bech32.encode(hrp, [0, ...words]);
}

const seed = bip39.mnemonicToSeedSync(M);
const root = HDKey.fromMasterSeed(seed);
console.log("=== 1. OFFICIAL BIP-84 TEST VECTORS ===");
console.log("BIP32 root xprv :", root.privateExtendedKey);
console.log("  spec (xprv form of zprv, same key material) — compare account xpub next");

const acct = root.derive("m/84'/0'/0'");
console.log("m/84'/0'/0' xpub:", acct.publicExtendedKey);

const vectors = [
  ["m/84'/0'/0'/0/0", "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu", "0330d54fd0dd420a6e5f8d3624f5f3482cae350f79d5f0753bf5beef9c2d91af3c"],
  ["m/84'/0'/0'/0/1", "bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g", "03e775fd51f0dfb8cd865d9ff1cca2a158cf651fe997fdc9fee9c1d3b5e995ea77"],
  ["m/84'/0'/0'/1/0", "bc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6el", "03025324888e429ab8e3dbaf1f7802648b9cd01e9b418485c5fa4c1b9b5700e1a6"],
];
let allOk = true;
for (const [path, wantAddr, wantPub] of vectors) {
  const n = root.derive(path);
  const gotIndep = indepP2wpkh(n.publicKey, "bc");
  const gotScure = btc.p2wpkh(n.publicKey, btc.NETWORK).address;
  const pubOk = hex(n.publicKey) === wantPub;
  const ok = gotIndep === wantAddr && gotScure === wantAddr && pubOk;
  allOk &&= ok;
  console.log(`${ok ? "PASS" : "FAIL"} ${path}\n   spec   ${wantAddr}\n   indep  ${gotIndep}\n   scure  ${gotScure}\n   pubkey ${pubOk ? "match" : hex(n.publicKey)}`);
}

console.log("\n--- app's deriveBitcoinAccount ---");
const appMain = deriveBitcoinAccount(M, "mainnet");
const appTest = deriveBitcoinAccount(M, "testnet");
console.log("mainnet:", appMain.address, appMain.path, "=> spec match:", appMain.address === vectors[0][1]);
console.log("testnet:", appTest.address, appTest.path);

// independent testnet check
const tnode = root.derive("m/84'/1'/0'/0/0");
console.log("indep tb1 :", indepP2wpkh(tnode.publicKey, "tb"), "=> match:", indepP2wpkh(tnode.publicKey, "tb") === appTest.address);
// cross-check: what does the MAINNET key look like encoded as tb1, and vice versa?
const mnode = root.derive("m/84'/0'/0'/0/0");
console.log("mainnet key encoded tb1:", indepP2wpkh(mnode.publicKey, "tb"));
console.log("testnet key encoded bc1:", indepP2wpkh(tnode.publicKey, "bc"));
console.log("mainnet/testnet keys equal? ", hex(mnode.privateKey) === hex(tnode.privateKey));

console.log("\n=== 2. CROSS-NETWORK CONFUSION ===");
for (const [addr, net] of [[appMain.address,"testnet"],[appTest.address,"mainnet"],[appMain.address,"mainnet"],[appTest.address,"testnet"]]) {
  try {
    const s = btc.OutScript.encode(btc.Address(networkParams(net)).decode(addr));
    console.log(`decode ${addr.slice(0,8)}.. as ${net}: ACCEPTED script=${hex(s)}`);
  } catch (e) { console.log(`decode ${addr.slice(0,8)}.. as ${net}: REJECTED (${e.message})`); }
}
console.log("allVectorsOk:", allOk);
