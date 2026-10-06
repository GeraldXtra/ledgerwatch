const bitcoin = require("../services/bitcoin.service");

const STATUS_FOR_KIND = {
  invalid: 400,
  rejected: 400,
  unreachable: 503,
  upstream: 502,
  unparseable: 502,
  ambiguous: 502,
};

function fail(res, outcome, context) {
  const status = STATUS_FOR_KIND[outcome.kind] || 502;

  if (status >= 500) {
    console.error(`[btc] ${context} failed: ${outcome.kind} — ${outcome.reason}`);
  }

  return res.status(status).json({
    error: outcome.reason,
    kind: outcome.kind,
    resendUnsafe: outcome.kind === "ambiguous",
  });
}

async function balance(req, res) {
  const { address, network } = req.query;
  const outcome = await bitcoin.getBalance(address, network);
  if (!outcome.ok) return fail(res, outcome, "balance");
  return res.json(outcome);
}

async function utxos(req, res) {
  const { address, network } = req.query;
  const outcome = await bitcoin.getUtxos(address, network);
  if (!outcome.ok) return fail(res, outcome, "utxos");
  return res.json(outcome);
}

async function fees(req, res) {
  const outcome = await bitcoin.getFeeRates(req.query.network);
  if (!outcome.ok) return fail(res, outcome, "fees");
  return res.json(outcome);
}

async function txs(req, res) {
  const { address, network } = req.query;
  const outcome = await bitcoin.getTxs(address, network);
  if (!outcome.ok) return fail(res, outcome, "txs");
  return res.json(outcome);
}

async function broadcast(req, res) {
  const { rawTx, network } = req.body || {};

  if (network === "mainnet" && String(process.env.ENABLE_MAINNET).toLowerCase() !== "true") {
    return res.status(403).json({
      error: "Bitcoin mainnet is switched off on this server. Set ENABLE_MAINNET=true to relay real transactions.",
      kind: "invalid",
      resendUnsafe: false,
    });
  }

  const outcome = await bitcoin.broadcast(rawTx, network);

  if (!outcome.ok) {
    if (outcome.kind === "ambiguous") {
      console.error(`[btc] broadcast on ${network} was AMBIGUOUS for user ${req.user._id}. The transaction may be live.`);
    }
    return fail(res, outcome, "broadcast");
  }

  console.log(`[btc] broadcast on ${network} accepted for user ${req.user._id}: ${outcome.txid}`);
  return res.status(201).json(outcome);
}

module.exports = { balance, utxos, fees, txs, broadcast };
