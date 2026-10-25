const ton = require("../services/ton.service");

const STATUS_FOR_KIND = { invalid: 400, rejected: 400, unreachable: 503, upstream: 502, unparseable: 502 };

function reply(res, outcome, context, okStatus = 200) {
  if (outcome.ok) return res.status(okStatus).json(outcome);
  const status = STATUS_FOR_KIND[outcome.kind] || 502;
  if (status >= 500) console.error(`[ton] ${context} failed: ${outcome.kind} — ${outcome.reason}`);
  return res.status(status).json({ error: outcome.reason, kind: outcome.kind });
}

const account = async (req, res) => reply(res, await ton.getAccount(req.query.address, req.query.network), "account");
const recipient = async (req, res) => reply(res, await ton.getRecipient(req.query.address, req.query.network), "recipient");
const seqno = async (req, res) => reply(res, await ton.getSeqno(req.query.address, req.query.network), "seqno");
const history = async (req, res) => reply(res, await ton.getHistory(req.query.address, req.query.network), "history");

async function send(req, res) {
  const { boc, network } = req.body;
  if (network === "mainnet" && String(process.env.ENABLE_MAINNET).toLowerCase() !== "true") {
    return res.status(403).json({ error: "TON mainnet is switched off on this server.", kind: "invalid" });
  }
  const outcome = await ton.send(boc, network);
  if (outcome.ok) console.log(`[ton] send on ${network} accepted for user ${req.user._id}: ${outcome.hash}`);
  return reply(res, outcome, "send", 201);
}

module.exports = { account, recipient, seqno, history, send };
