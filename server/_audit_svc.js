const b = require("./src/services/bitcoin.service");
(async () => {
  console.log("=== 6. LIVE SERVICE READS ===");
  const fm = await b.getFeeRates("mainnet");
  console.log("mainnet fees:", JSON.stringify({ok:fm.ok,source:fm.source,fast:fm.fast,medium:fm.medium,slow:fm.slow}));
  const ft = await b.getFeeRates("testnet");
  console.log("testnet fees:", JSON.stringify({ok:ft.ok,source:ft.source,fast:ft.fast,medium:ft.medium,slow:ft.slow}));

  // BIP-84 vector address (public, from the all-zeros test mnemonic - anyone can see it)
  const A = "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu";
  const bal = await b.getBalance(A, "mainnet");
  console.log("balance vector addr:", JSON.stringify(bal));
  const ux = await b.getUtxos(A, "mainnet");
  console.log("utxos:", ux.ok ? `n=${ux.utxos.length} total=${ux.total} unconfirmed=${ux.utxos.filter(u=>!u.confirmed).length}` : ux);
  const tip = await b.getTipHeight("mainnet");
  console.log("tip:", JSON.stringify(tip));

  console.log("\n=== 7. HOSTILE / MALFORMED INPUT ===");
  const cases = [
    [undefined,"mainnet"],[null,"mainnet"],[123,"mainnet"],[{},"mainnet"],[[],"mainnet"],
    ["../../../etc/passwd","mainnet"],["bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu/../../blocks","mainnet"],
    ["http://169.254.169.254/latest/meta-data","mainnet"],
    ["bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu","MAINNET"],
    ["bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu","__proto__"],
    ["bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu","constructor"],
    ["bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu","toString"],
    ["tb1q6rz28mcfaxtmd6v789l9rrlrusdprr9pqcpvkl","mainnet"],   // testnet addr, mainnet net
    ["bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu","testnet"],   // mainnet addr, testnet net
    ["bc1"+"q".repeat(200),"mainnet"],
    ["bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyX","mainnet"],   // bad checksum, valid charset
    ["1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2","mainnet"],           // P2PKH mainnet
  ];
  for (const [addr, net] of cases) {
    const r = b.validateAddress(addr, net);
    console.log(`  ${JSON.stringify(String(addr).slice(0,45))} / ${net} -> ${r.ok ? "ACCEPTED "+r.address.slice(0,20) : r.kind+": "+r.reason.slice(0,55)}`);
  }
  console.log("\n  validateNetwork prototype probe:", JSON.stringify(b.validateNetwork("hasOwnProperty")), JSON.stringify(b.validateNetwork("__proto__")));

  console.log("\n=== 8. validateRawTx ===");
  const rt = [["", ], ["zz".repeat(40)], ["ab".repeat(19)], ["0".repeat(200002)], ["  02000000AABB"+"00".repeat(40)+"  "], [Buffer.alloc(10)], [{}], ["0102030"]];
  for (const [v] of rt) {
    const r = b.validateRawTx(v);
    console.log(`  len=${typeof v === "string" ? v.length : typeof v} -> ${r.ok ? "ACCEPTED len="+r.rawTx.length : r.kind+": "+r.reason.slice(0,60)}`);
  }

  console.log("\n=== 9. ReDoS timing on the address regex ===");
  for (const n of [80, 89, 90]) {
    const evil = "bc1" + "q".repeat(n-3);
    const t = Date.now(); for (let i=0;i<20000;i++) b.validateAddress(evil, "mainnet");
    console.log(`  len=${n}: 20k validations in ${Date.now()-t}ms`);
  }
})();
