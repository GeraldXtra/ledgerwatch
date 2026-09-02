import * as btc from "@scure/btc-signer";
import { deriveBitcoinAccount, deriveBitcoinPrivateKey } from "./src/features/wallet/bitcoin/derivation.js";
import { estimateVsize, estimateFee, selectUtxos, buildP2wpkhSpend, DUST_LIMIT_SATS } from "./src/features/wallet/bitcoin/tx.js";

const M = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const acct = deriveBitcoinAccount(M, "testnet");
const pk = deriveBitcoinPrivateKey(M, "testnet");
const DEST = "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx";
const hexToBytes = (h)=>Uint8Array.from(h.match(/../g).map(x=>parseInt(x,16)));

const u = (i, v, c=true) => ({ txid: String(i).padStart(2,"0").repeat(32).slice(0,64), vout: 0, value: v, confirmed: c });

console.log("=== 3. VSIZE: estimate vs REAL SIGNED ===");
for (const [nIn, nOut] of [[1,2],[1,1],[2,1],[2,2],[3,2],[5,2],[10,2]]) {
  const utxos = Array.from({length:nIn}, (_,i)=>u(i+1, 1000000));
  const amt = nOut===2 ? 500000 : nIn*1000000 - 5000;
  const r = buildP2wpkhSpend({utxos, fromAddress: acct.address, toAddress: DEST, amountSats: amt, feeRateSatPerVb: 5, privateKey: pk, network:"testnet"});
  if (!r.ok) { console.log(nIn,nOut,"build failed:", r.reason); continue; }
  const decoded = btc.Transaction.fromRaw(hexToBytes(r.hex));
  const est = estimateVsize(decoded.inputsLength, Array.from({length:decoded.outputsLength},(_,k)=>decoded.getOutput(k).script.length));
  console.log(`in=${decoded.inputsLength} out=${decoded.outputsLength}  real vsize=${r.vsize}  estimate=${est}  delta=${est-r.vsize}  realFeeRate=${r.feeRateSatPerVb}`);
}

console.log("\n=== 4. SEQUENCE / BIP-125 RBF ===");
const r1 = buildP2wpkhSpend({utxos:[u(1,200000)], fromAddress: acct.address, toAddress: DEST, amountSats: 50000, feeRateSatPerVb: 10, privateKey: pk, network:"testnet"});
const d1 = btc.Transaction.fromRaw(hexToBytes(r1.hex));
for (let i=0;i<d1.inputsLength;i++){
  const seq = d1.getInput(i).sequence;
  console.log(`input ${i} sequence = ${seq} (0x${(seq>>>0).toString(16)})  RBF-signalled(<0xfffffffe)=${seq < 0xfffffffe}`);
}
console.log("locktime:", d1.lockTime, " raw hex tail:", r1.hex.slice(-16));

console.log("\n=== 5. SELECTION EDGE CASES ===");
const base = { feeRateSatPerVb: 10, destScriptLen: 22, changeScriptLen: 22 };
// exact amount+fee, single utxo
let s = selectUtxos({...base, utxos:[u(1, 50000+110*10)], amountSats:50000});
console.log("exact amount+feeNoChange (51100):", JSON.stringify(s.ok?{fee:s.fee,change:s.change,hasChange:s.hasChange,n:s.selected.length}:s.reason));
// amount+fee exceeds total
s = selectUtxos({...base, utxos:[u(1,50000)], amountSats:50000});
console.log("total==amount, no room for fee:", s.ok, s.ok?s.fee:s.reason.slice(0,80));
// many dust utxos
const dust = Array.from({length:60},(_,i)=>u(i+1, 600));
s = selectUtxos({...base, utxos:dust, amountSats:20000});
console.log("60x600sat dust, send 20000 @10:", s.ok, s.ok?`n=${s.selected.length} fee=${s.fee} change=${s.change}`:s.reason.slice(0,140));
// dust at rate 1
s = selectUtxos({...base, feeRateSatPerVb:1, utxos:dust, amountSats:20000});
console.log("60x600sat dust, send 20000 @1 :", s.ok, s.ok?`n=${s.selected.length} fee=${s.fee} change=${s.change} inputTotal=${s.inputTotal}`:s.reason.slice(0,140));
// negative / zero-value utxo
s = selectUtxos({...base, utxos:[u(1,200000), {txid:"z".repeat(64),vout:0,value:0}], amountSats:50000});
console.log("with a 0-value utxo present:", s.ok, s.ok?`n=${s.selected.length}`:"");
// worst-case burn: force no-change at a very high fee rate
for (const rate of [10, 50, 200, 500]) {
  const feeWith = estimateFee(1,[22,22],rate), feeNo = estimateFee(1,[22],rate);
  const total = 1000000;
  const amt = total - feeWith - (DUST_LIMIT_SATS-1); // change = 545 -> dust
  const rr = selectUtxos({...base, feeRateSatPerVb:rate, utxos:[u(1,total)], amountSats:amt});
  console.log(`rate=${rate}: feeNoChange=${feeNo} actualFee=${rr.fee} OVERPAY=${rr.fee-feeNo} sats  hasChange=${rr.hasChange}`);
}
