const tron = require("../services/tron.service");

const STATUS_FOR_KIND = { invalid: 400, rejected: 400, unreachable: 503, upstream: 502, unparseable: 502, ambiguous: 502 };

function reply(res, outcome, context, okStatus = 200) {
  if (outcome.ok) return res.status(okStatus).json(outcome);
  const status = STATUS_FOR_KIND[outcome.kind] || 502;
  if (status >= 500) console.error(`[tron] ${context} failed: ${outcome.kind} — ${outcome.reason}`);
  return res.status(status).json({ error: outcome.reason, kind: outcome.kind, resendUnsafe: outcome.kind === "ambiguous" });
}

const account = async (req, res) => reply(res, await tron.getAccount(req.query.address, req.query.network), "account");
const block = async (req, res) => reply(res, await tron.getBlock(req.query.network), "block");
const params = async (req, res) => reply(res, await tron.getParams(req.query.network), "params");
const tx = async (req, res) => reply(res, await tron.getTxInfo(req.query.txid, req.query.network), "tx");
const history = async (req, res) => reply(res, await tron.getHistory(req.query.address, req.query.network), "history");

async function estimate(req, res) {
  const { owner, to, amount, network } = req.query;
  return reply(res, await tron.estimateTokenTransfer({ owner, to, amount, network }), "estimate");
}

async function broadcast(req, res) {
  const { hex, network } = req.body || {};
  if (network === "mainnet" && String(process.env.ENABLE_MAINNET).toLowerCase() !== "true") {
    return res.status(403).json({ error: "Tron mainnet is switched off on this server.", kind: "invalid", resendUnsafe: false });
  }
  const outcome = await tron.broadcastHex(hex, network);
  if (outcome.ok) console.log(`[tron] broadcast on ${network} accepted for user ${req.user._id}: ${outcome.txid}`);
  else if (outcome.kind === "ambiguous") console.error(`[tron] broadcast on ${network} was AMBIGUOUS for user ${req.user._id}.`);
  return reply(res, outcome, "broadcast", 201);
}

module.exports = { account, block, params, estimate, tx, history, broadcast };
