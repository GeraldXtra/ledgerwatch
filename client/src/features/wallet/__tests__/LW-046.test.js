import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  key: (i) => [...store.keys()][i] ?? null,
  get length() {
    return store.size;
  },
};

const source = readFileSync(new URL("../keystore.js", import.meta.url), "utf8");

function token(id) {
  const part = (o) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${part({ alg: "HS256" })}.${part({ id, v: 0 })}.signature`;
}

describe("LW-046 — the keystore module no longer pulls the whole of ethers into the first download", () => {
  it("imports only getAddress from ethers statically", () => {
    const statics = [...source.matchAll(/^import\s+([^;]+?)\s+from\s+["']ethers["'];?$/gm)].map((m) => m[1].trim());
    expect(statics).toEqual(["{ getAddress }"]);
  });

  it("loads the wallet class only when a keystore is decrypted", () => {
    expect(source).toMatch(/await import\("ethers"\)/);
    expect(source).not.toMatch(/\bethers\.Wallet\b/);
    expect(source).not.toMatch(/\bcreateRandom\b|\bfromPhrase\b/);
  });
});

describe("LW-046 — the keystore still reads, writes and decrypts as before", () => {
  let keystore;
  let walletKeys;

  beforeAll(async () => {
    store.set("ledgerwatch_token", token("user-1"));
    keystore = await import("../keystore");
    walletKeys = await import("../walletKeys");
  });

  it(
    "stores a new wallet encrypted, reads its address back, and decrypts it only with the password",
    async () => {
      const { wallet, address } = walletKeys.createWallet();
      expect(keystore.hasWallet()).toBe(false);
      await keystore.encryptAndStore(wallet, "correct horse battery staple");
      expect(keystore.hasWallet()).toBe(true);
      expect(keystore.getStoredAddress()).toBe(address);
      expect([...store.keys()]).toContain("ledgerwatch.wallet.keystore.user-1");

      const unlocked = await keystore.unlockWallet("correct horse battery staple");
      expect(unlocked.address).toBe(address);
      await expect(keystore.unlockWallet("wrong password")).rejects.toThrow(/incorrect password|invalid password/i);

      const imported = await keystore.importFromKeystore(keystore.getKeystoreJson(), "correct horse battery staple");
      expect(imported.address).toBe(address);
    },
    180000
  );

  it("imports from a phrase and a private key without touching storage", () => {
    const before = new Map(store);
    const original = walletKeys.createWallet();
    expect(walletKeys.importFromMnemonic(`  ${original.mnemonic}  `).address).toBe(original.address);
    expect(walletKeys.importFromPrivateKey(original.privateKey.slice(2)).address).toBe(original.address);
    expect(walletKeys.importFromPrivateKey(original.privateKey).address).toBe(original.address);
    expect(new Map(store)).toEqual(before);
  });
});
