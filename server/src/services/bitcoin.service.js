const utxo = require("./utxo.service");

const COIN = "bitcoin";

module.exports = {
  getBalance: (address, network) => utxo.getBalance(address, network, COIN),
  getUtxos: (address, network) => utxo.getUtxos(address, network, COIN),
  getFeeRates: (network) => utxo.getFeeRates(network, COIN),
  broadcast: (rawHexTx, network) => utxo.broadcast(rawHexTx, network, COIN),
  getRawTx: (txid, network) => utxo.getRawTx(txid, network, COIN),
  getTxs: (address, network) => utxo.getTxs(address, network, COIN),
  getTipHeight: (network) => utxo.getTipHeight(network, COIN),
  validateAddress: (address, network) => utxo.validateAddress(address, network, COIN),
  validateNetwork: (network) => utxo.validateNetwork(network, COIN),
  validateRawTx: utxo.validateRawTx,
  NETWORKS: Object.keys(utxo.COINS[COIN].networks),
  MIN_RELAY_SAT_PER_VB: utxo.COINS[COIN].minRelay,
};
