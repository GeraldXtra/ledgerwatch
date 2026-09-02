import * as bip39 from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { deriveBitcoinAccount, deriveBitcoinPrivateKey, canDeriveBitcoin } from "./src/features/wallet/bitcoin/derivation.js";
import { buildP2wpkhSpend } from "./src/features/wallet/bitcoin/tx.js";

// Two throwaway test seeds, generated here, never stored, controlling nothing.
const A = bip39.entropyToMnemonic(new Uint8Array(16).fill(0x11), wordlist);
const B = bip39.entropyToMnemonic(new Uint8Array(16).fill(0x22), wordlist);
const u = (v, c = true) => ({ txid: "aa".repeat(32), vout: 0, value: v, confirmed: c });

console.log("=== 10. STALE CACHED ADDRESS + A DIFFERENT KEYSTORE UNDER THE SAME ACCOUNT ===");
const oldAcct = deriveBitcoinAccount(A, "mainnet");   // what localStorage still holds
const newAcct = deriveBitcoinAccount(B, "mainnet");   // what the keystore now is
const newKey = deriveBitcoinPrivateKey(B, "mainnet");
console.log("  cached address shown by panel :", oldAcct.address);
console.log("  address the keystore can sign :", newAcct.address);
const r = buildP2wpkhSpend({ utxos: [u(200000)], fromAddress: oldAcct.address, toAddress: newAcct.address, amountSats: 50000, feeRateSatPerVb: 10, privateKey: newKey, network: "mainnet" });
console.log("  SEND from stale address with new key ->", r.ok ? "SIGNED (would be invalid)" : "refused: " + r.reason);

console.log("\n=== 11. THE canDeriveBitcoin GUARD AT BitcoinPanel.jsx:150 ===");
for (const p of ["", "not a real phrase at all", A]) {
  const v = canDeriveBitcoin(p);
  console.log(`  canDeriveBitcoin(${JSON.stringify(p.slice(0, 18))}) -> ok=${v.ok} ; !value = ${!v}`);
}

console.log("\n=== 12. THE SAME SPEND AT DIFFERENT FEE RATES (mainnet) ===");
const mAcct = deriveBitcoinAccount(A, "mainnet"), mKey = deriveBitcoinPrivateKey(A, "mainnet");
const dest = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";
for (const [label, rate] of [["stale testnet medium / fallback", 2], ["mainnet today (measured)", 2], ["busy mainnet", 120], ["fee spike", 400]]) {
  const rr = buildP2wpkhSpend({ utxos: [u(5_000_000)], fromAddress: mAcct.address, toAddress: dest, amountSats: 1_000_000, feeRateSatPerVb: rate, privateKey: mKey, network: "mainnet" });
  console.log(`  ${label.padEnd(32)} rate=${String(rate).padStart(3)}  fee=${String(rr.fee).padStart(6)} sats  vsize=${rr.vsize}`);
}

console.log("\n=== 13. SEND-MAX BY HAND (no send-max button exists) ===");
const total = 5_000_000;
for (const amt of [total, total - 220, total - 221, total - 500, total - 766]) {
  const sm = buildP2wpkhSpend({ utxos: [u(total)], fromAddress: mAcct.address, toAddress: dest, amountSats: amt, feeRateSatPerVb: 2, privateKey: mKey, network: "mainnet" });
  console.log(`  amount=${amt} (total-${total - amt}) -> ${sm.ok ? `SIGNED fee=${sm.fee} change=${sm.change} hasChange=${sm.change > 0}` : "refused: " + sm.reason.slice(0, 90)}`);
}

console.log("\n=== 14. THE fee > amount GUARD ===");
for (const [amt, rate, bal] of [[1000, 400, 100_000], [59_000, 400, 60_000], [600, 5, 100_000], [1000, 20, 100_000]]) {
  const g = buildP2wpkhSpend({ utxos: [u(bal)], fromAddress: mAcct.address, toAddress: dest, amountSats: amt, feeRateSatPerVb: rate, privateKey: mKey, network: "mainnet" });
  console.log(`  send ${amt} of ${bal} @${rate} -> ${g.ok ? `SIGNED fee=${g.fee} change=${g.change}` : "refused: " + g.reason.slice(0, 95)}`);
}

console.log("\n=== 15. HOSTILE amountSats / feeRateSatPerVb ===");
for (const [amt, rate] of [[50000.5, 10], [NaN, 10], [Infinity, 10], [50000, NaN], [50000, Infinity], [50000, 0.0001], [1e15, 10], [-50000, 10]]) {
  const rr = buildP2wpkhSpend({ utxos: [u(200000)], fromAddress: mAcct.address, toAddress: dest, amountSats: amt, feeRateSatPerVb: rate, privateKey: mKey, network: "mainnet" });
  console.log(`  amt=${amt} rate=${rate} -> ${rr.ok ? `SIGNED fee=${rr.fee} vsize=${rr.vsize} realRate=${rr.feeRateSatPerVb}` : "refused: " + rr.reason.slice(0, 62)}`);
}

console.log("\n=== 16. UTXO FIELDS THE SERVER COULD RETURN ===");
for (const bad of [
  { txid: "aa".repeat(32), vout: 0, value: 200000 },                    // confirmed absent
  { txid: "", vout: 0, value: 200000, confirmed: true },                // empty txid
  { txid: "aa".repeat(32), vout: 0, value: 200000.7, confirmed: true }, // fractional sats
  { txid: "aa".repeat(32), vout: -1, value: 200000, confirmed: true },  // negative vout
]) {
  let out;
  try {
    const rr = buildP2wpkhSpend({ utxos: [bad], fromAddress: mAcct.address, toAddress: dest, amountSats: 50000, feeRateSatPerVb: 10, privateKey: mKey, network: "mainnet" });
    out = rr.ok ? `SIGNED fee=${rr.fee}` : "refused: " + rr.reason.slice(0, 60);
  } catch (e) { out = "THREW: " + e.message.slice(0, 90); }
  console.log(`  ${JSON.stringify(bad).slice(0, 78)} -> ${out}`);
}
