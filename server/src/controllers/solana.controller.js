const solana = require("../services/solana.service");

const STATUS_FOR_KIND = { invalid: 400, rejected: 400, unreachable: 503, upstream: 502, unparseable: 502 };

function reply(res, outcome, context, okStatus = 200) {
  if (outcome.ok) return res.status(okStatus).json(outcome);
  const status = STATUS_FOR_KIND[outcome.kind] || 502;
  if (status >= 500) console.error(`[solana] ${context} failed: ${outcome.kind} — ${outcome.reason}`);
  return res.status(status).json({ error: outcome.reason, kind: outcome.kind });
}

const account = async (req, res) => reply(res, await solana.getAccount(req.query.address, req.query.network), "account");
const blockhash = async (req, res) => reply(res, await solana.getBlockhash(req.query.network), "blockhash");
const recipient = async (req, res) => reply(res, await solana.getRecipient(req.query.address, req.query.mint, req.query.network), "recipient");
const priority = async (req, res) => reply(res, await solana.getPriorityFee(req.query.network), "priority");
const status = async (req, res) => reply(res, await solana.getStatus(req.query.signature, req.query.network), "status");
const history = async (req, res) => reply(res, await solana.getHistory(req.query.address, req.query.network), "history");

async function send(req, res) {
  const { transaction, network } = req.body;
  if (network === "mainnet" && String(process.env.ENABLE_MAINNET).toLowerCase() !== "true") {
    return res.status(403).json({ error: "Solana mainnet is switched off on this server.", kind: "invalid" });
  }
  const outcome = await solana.send(transaction, network);
  if (outcome.ok) console.log(`[solana] send on ${network} accepted for user ${req.user._id}: ${outcome.signature}`);
  return reply(res, outcome, "send", 201);
}

module.exports = { account, blockhash, recipient, priority, status, history, send };
