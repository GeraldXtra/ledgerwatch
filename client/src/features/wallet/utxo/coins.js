import * as bip39 from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { HDKey } from "@scure/bip32";
import * as btc from "@scure/btc-signer";

export const LITECOIN_PARAMS = Object.freeze({ bech32: "ltc", pubKeyHash: 0x30, scriptHash: 0x32, wif: 0xb0 });
export const LITECOIN_TESTNET_PARAMS = Object.freeze({ bech32: "tltc", pubKeyHash: 0x6f, scriptHash: 0x3a, wif: 0xef });
export const DOGECOIN_PARAMS = Object.freeze({ bech32: "doge", pubKeyHash: 0x1e, scriptHash: 0x16, wif: 0x9e });

export const UTXO_COINS = Object.freeze({
  litecoin: {
    coin: "litecoin",
    label: "Litecoin",
    symbol: "LTC",
    decimals: 8,
    unitName: "litoshis",
    rateUnit: "litoshis per vbyte",
    script: "p2wpkh",
    dust: 5460,
    minRate: 1,
    rbf: true,
    networks: {
      mainnet: {
        path: "m/84'/2'/0'/0/0",
        params: LITECOIN_PARAMS,
        symbol: "LTC",
        prefix: "ltc1",
        explorerTx: "https://litecoinspace.org/tx/",
        explorerAddress: "https://litecoinspace.org/address/",
      },
      testnet: {
        path: "m/84'/1'/0'/0/0",
        params: LITECOIN_TESTNET_PARAMS,
        symbol: "tLTC",
        prefix: "tltc1",
        explorerTx: "https://litecoinspace.org/testnet/tx/",
        explorerAddress: "https://litecoinspace.org/testnet/address/",
      },
    },
  },
  dogecoin: {
    coin: "dogecoin",
    label: "Dogecoin",
    symbol: "DOGE",
    decimals: 8,
    unitName: "koinu",
    rateUnit: "koinu per byte",
    script: "p2pkh",
    dust: 1000000,
    minRate: 1000,
    rbf: false,
    networks: {
      mainnet: {
        path: "m/44'/3'/0'/0/0",
        params: DOGECOIN_PARAMS,
        symbol: "DOGE",
        prefix: "D",
        explorerTx: "https://blockchair.com/dogecoin/transaction/",
        explorerAddress: "https://blockchair.com/dogecoin/address/",
      },
    },
  },
});

export function coinConfig(coin, network) {
  const c = UTXO_COINS[coin];
  if (!c) throw new Error(`Unknown coin: ${coin}`);
  const net = c.networks[network];
  if (!net) throw new Error(`${c.label} is not available on ${network}.`);
  return { ...c, network, net };
}

function normalise(mnemonic) {
  return String(mnemonic || "").trim().toLowerCase().split(/\s+/).join(" ");
}

export function canDeriveUtxo(mnemonic, coin) {
  const label = (UTXO_COINS[coin] && UTXO_COINS[coin].label) || "this coin";
  if (typeof mnemonic !== "string" || mnemonic.trim().length === 0) {
    return {
      ok: false,
      reason: `This wallet has no recovery phrase, so a ${label} account cannot be derived from it. Wallets imported from a bare private key carry no seed to derive from.`,
    };
  }
  if (!bip39.validateMnemonic(normalise(mnemonic), wordlist)) {
    return { ok: false, reason: "That recovery phrase is not valid. Check the spelling and the word order." };
  }
  return { ok: true };
}

function deriveNode(mnemonic, coin, network) {
  const cfg = coinConfig(coin, network);
  const check = canDeriveUtxo(mnemonic, coin);
  if (!check.ok) throw new Error(check.reason);
  const node = HDKey.fromMasterSeed(bip39.mnemonicToSeedSync(normalise(mnemonic))).derive(cfg.net.path);
  if (!node.privateKey || !node.publicKey) throw new Error(`That recovery phrase did not produce a usable ${cfg.label} key.`);
  return { node, cfg };
}

export function paymentFor(publicKey, cfg) {
  return cfg.script === "p2wpkh" ? btc.p2wpkh(publicKey, cfg.net.params) : btc.p2pkh(publicKey, cfg.net.params);
}

export function deriveUtxoAccount(mnemonic, coin, network) {
  const { node, cfg } = deriveNode(mnemonic, coin, network);
  return { address: paymentFor(node.publicKey, cfg).address, path: cfg.net.path, coin, network };
}

export function deriveUtxoPrivateKey(mnemonic, coin, network) {
  return deriveNode(mnemonic, coin, network).node.privateKey;
}

export function formatUnits(value, decimals = 8) {
  const v = BigInt(Math.trunc(Number(value) || 0));
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = (abs % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

export function parseUnits(text, decimals = 8) {
  const s = String(text || "").trim();
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  if (frac.length > decimals) return null;
  const v = BigInt(whole) * 10n ** BigInt(decimals) + BigInt((frac + "0".repeat(decimals)).slice(0, decimals));
  return v > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(v);
}
