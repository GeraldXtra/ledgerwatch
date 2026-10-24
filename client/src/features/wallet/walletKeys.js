import { Wallet } from "ethers";

export function createWallet() {
  const wallet = Wallet.createRandom();
  return {
    wallet,
    address: wallet.address,
    mnemonic: wallet.mnemonic ? wallet.mnemonic.phrase : null,
    privateKey: wallet.privateKey,
  };
}

export function importFromMnemonic(phrase) {
  const wallet = Wallet.fromPhrase(phrase.trim());
  return { wallet, address: wallet.address };
}

export function importFromPrivateKey(pk) {
  const key = pk.trim();
  const wallet = new Wallet(key.startsWith("0x") ? key : "0x" + key);
  return { wallet, address: wallet.address };
}
