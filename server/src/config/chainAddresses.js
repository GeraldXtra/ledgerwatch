const utxo = require("../services/utxo.service");
const tron = require("../services/tron.service");
const solana = require("../services/solana.service");
const ton = require("../services/ton.service");

const VALIDATORS = {
  bitcoin: (address, network) => utxo.validateAddress(address, network, "bitcoin"),
  litecoin: (address, network) => utxo.validateAddress(address, network, "litecoin"),
  dogecoin: (address, network) => utxo.validateAddress(address, network, "dogecoin"),
  tron: (address, network) => tron.validateAddress(address, network),
  solana: (address, network) => solana.validateAddress(address, network),
  ton: (address, network) => ton.validateAddress(address, network),
};

function validateChainAddress(chain, network, address) {
  const check = Object.prototype.hasOwnProperty.call(VALIDATORS, chain) ? VALIDATORS[chain] : null;
  if (!check) return { ok: false, reason: `Chain must be one of ${Object.keys(VALIDATORS).join(", ")}.` };
  if (network === "mainnet" && String(process.env.ENABLE_MAINNET).toLowerCase() !== "true") {
    return { ok: false, reason: "Mainnet is switched off on this server." };
  }
  const r = check(address, network);
  return r.ok ? { ok: true, chain, network, address: r.address } : { ok: false, reason: r.reason };
}

module.exports = { validateChainAddress, chainsWithAddresses: () => Object.keys(VALIDATORS) };
