const utxo = require("../services/utxo.service");

const STATUS_FOR_KIND = {
  invalid: 400,
  rejected: 400,
  unreachable: 503,
  upstream: 502,
  unparseable: 502,
  ambiguous: 502,
};

function fail(res, outcome, context, coin) {
  const status = STATUS_FOR_KIND[outcome.kind] || 502;
  const log = (utxo.COINS[coin] && utxo.COINS[coin].log) || "utxo";

  if (status >= 500) {
    console.error(`[${log}] ${context} failed: ${outcome.kind} — ${outcome.reason}`);
  }

  return res.status(status).json({
    error: outcome.reason,
    kind: outcome.kind,
    resendUnsafe: outcome.kind === "ambiguous",
  });
}

function coinOf(req) {
  const raw = req.body.coin || req.query.coin;
  const c = utxo.validateCoin(raw);
  return c.ok ? c.coin : null;
}

function badCoin(res) {
  return res.status(400).json({
    error: `Coin must be one of ${Object.keys(utxo.COINS).join(", ")}.`,
    kind: "invalid",
    resendUnsafe: false,
  });
}

async function balance(req, res) {
  const coin = coinOf(req);
  if (!coin) return badCoin(res);
  const { address, network } = req.query;
  const outcome = await utxo.getBalance(address, network, coin);
  if (!outcome.ok) return fail(res, outcome, "balance", coin);
  return res.json(outcome);
}

async function utxos(req, res) {
  const coin = coinOf(req);
  if (!coin) return badCoin(res);
  const { address, network } = req.query;
  const outcome = await utxo.getUtxos(address, network, coin);
  if (!outcome.ok) return fail(res, outcome, "utxos", coin);
  return res.json(outcome);
}

async function fees(req, res) {
  const coin = coinOf(req);
  if (!coin) return badCoin(res);
  const outcome = await utxo.getFeeRates(req.query.network, coin);
  if (!outcome.ok) return fail(res, outcome, "fees", coin);
  return res.json(outcome);
}

async function txs(req, res) {
  const coin = coinOf(req);
  if (!coin) return badCoin(res);
  const { address, network } = req.query;
  const outcome = await utxo.getTxs(address, network, coin);
  if (!outcome.ok) return fail(res, outcome, "txs", coin);
  return res.json(outcome);
}

async function rawTx(req, res) {
  const coin = coinOf(req);
  if (!coin) return badCoin(res);
  const { txid, network } = req.query;
  const outcome = await utxo.getRawTx(txid, network, coin);
  if (!outcome.ok) return fail(res, outcome, "raw transaction", coin);
  return res.json(outcome);
}

function coins(req, res) {
  const mainnet = String(process.env.ENABLE_MAINNET).toLowerCase() === "true";
  return res.json({
    coins: utxo.coinsAvailable().map((c) => ({
      ...c,
      networks: c.networks.filter((n) => n !== "mainnet" || mainnet),
    })),
  });
}

async function broadcast(req, res) {
  const coin = coinOf(req);
  if (!coin) return badCoin(res);
  const { rawTx: hex, network } = req.body;
  const label = utxo.COINS[coin].label;
  const log = utxo.COINS[coin].log;

  if (network === "mainnet" && String(process.env.ENABLE_MAINNET).toLowerCase() !== "true") {
    return res.status(403).json({
      error: `${label} mainnet is switched off on this server. Set ENABLE_MAINNET=true to relay real transactions.`,
      kind: "invalid",
      resendUnsafe: false,
    });
  }

  const outcome = await utxo.broadcast(hex, network, coin);

  if (!outcome.ok) {
    if (outcome.kind === "ambiguous") {
      console.error(`[${log}] broadcast on ${network} was AMBIGUOUS for user ${req.user._id}. The transaction may be live.`);
    }
    return fail(res, outcome, "broadcast", coin);
  }

  console.log(`[${log}] broadcast on ${network} accepted for user ${req.user._id}: ${outcome.txid}`);
  return res.status(201).json(outcome);
}

module.exports = { balance, utxos, fees, txs, rawTx, coins, broadcast };
