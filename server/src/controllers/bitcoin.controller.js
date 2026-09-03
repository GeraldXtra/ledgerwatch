const bitcoin = require("../services/bitcoin.service");

/**
 * HTTP shape only. Every decision about what to call, in what order, and what a
 * failure means lives in `bitcoin.service.js`. This file's whole job is to turn a
 * typed outcome into a status code and a sentence a human can act on.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE SERVER LEARNS, AND WHAT IT NEVER LEARNS
 * ---------------------------------------------------------------------------
 * A public address, and an already signed transaction. That is the entire list.
 * No private key, no recovery phrase and no password reaches this process, by the
 * same design as the EVM wallet: keys are generated, encrypted and decrypted in
 * the browser (client/src/features/wallet/keystore.js) and signing happens there
 * too. A signed transaction is public the instant it is broadcast, so relaying one
 * gives away nothing that the mempool would not.
 *
 * These routes therefore hold no per user Bitcoin state. `requireAuth` is still
 * mandatory on every one of them, for two reasons that are easy to under weigh:
 * an open endpoint that takes a user supplied path segment and a network name is
 * a free outbound request proxy, and an open broadcast endpoint is a free
 * transaction relay. Neither should be reachable without a session.
 *
 * ---------------------------------------------------------------------------
 * A NOTE ON MAINNET
 * ---------------------------------------------------------------------------
 * The same ENABLE_MAINNET switch that gates the EVM mainnets in
 * `config/chains.js` gates Bitcoin mainnet BROADCAST here: `POST /broadcast`
 * with `network=mainnet` answers 403 unless it is `true`. The four read routes
 * only ever touch a public block explorer and are allowed on either network,
 * because reading a balance moves nothing. An earlier version of this comment
 * said the gate did not reach here; it does now, so that one setting is the
 * whole answer to "can this deployment move real money".
 */

/**
 * One typed outcome to one HTTP response.
 *
 * The mapping is deliberately not "anything that failed is a 500". A caller has to
 * be able to tell, from the status alone, whether to fix its input, retry later,
 * or stop and warn the user. Collapsing those into one code is how a retry loop
 * ends up hammering an endpoint that will never accept the request.
 */
const STATUS_FOR_KIND = {
  invalid: 400, // our input was wrong. Retrying unchanged cannot help.
  rejected: 400, // the network said no, with a reason. Same: do not retry.
  unreachable: 503, // nothing answered. A retry later may well work.
  upstream: 502, // something answered, badly.
  unparseable: 502, // 200, wrong shape. A provider bug, not the user's fault.
  ambiguous: 502, // a broadcast MAY have landed. See below.
};

function fail(res, outcome, context) {
  const status = STATUS_FOR_KIND[outcome.kind] || 502;

  // Log the kind and the reason, never the address and never a URL. The address
  // is the user's own data and a log file is the wrong place for it.
  if (status >= 500) {
    console.error(`[btc] ${context} failed: ${outcome.kind} — ${outcome.reason}`);
  }

  return res.status(status).json({
    error: outcome.reason,
    // `kind` is part of the contract, not debug noise. The client needs it to
    // decide whether to offer a retry, and `ambiguous` in particular must never
    // be rendered as a plain failure.
    kind: outcome.kind,
    // The one case where "it failed" is actively dangerous advice. Flagged
    // separately so a client cannot miss it by only reading `error`.
    resendUnsafe: outcome.kind === "ambiguous",
  });
}

// GET /api/bitcoin/balance?address=&network=
async function balance(req, res) {
  const { address, network } = req.query;
  const outcome = await bitcoin.getBalance(address, network);
  if (!outcome.ok) return fail(res, outcome, "balance");
  return res.json(outcome);
}

// GET /api/bitcoin/utxos?address=&network=
async function utxos(req, res) {
  const { address, network } = req.query;
  const outcome = await bitcoin.getUtxos(address, network);
  if (!outcome.ok) return fail(res, outcome, "utxos");
  return res.json(outcome);
}

// GET /api/bitcoin/fees?network=
async function fees(req, res) {
  const outcome = await bitcoin.getFeeRates(req.query.network);
  if (!outcome.ok) return fail(res, outcome, "fees");
  return res.json(outcome);
}

// GET /api/bitcoin/txs?address=&network=
async function txs(req, res) {
  const { address, network } = req.query;
  const outcome = await bitcoin.getTxs(address, network);
  if (!outcome.ok) return fail(res, outcome, "txs");
  return res.json(outcome);
}

/**
 * POST /api/bitcoin/broadcast  { rawTx, network }
 *
 * The transaction arrives already signed. This endpoint cannot alter it: any edit
 * invalidates the signature, so the worst it can do is refuse to relay it.
 *
 * Note the deliberate absence of an idempotency key. Bitcoin already has one, and
 * it is the txid: rebroadcasting identical bytes is a no op on the network. The
 * hazard is not a duplicate relay, it is a duplicate SEND, where the user signs a
 * second transaction from different inputs because we told them the first failed.
 * That is why `ambiguous` exists and why it is never reported as a failure.
 */
async function broadcast(req, res) {
  const { rawTx, network } = req.body || {};

  /**
   * THE SAME GATE AS EVERY OTHER REAL MONEY NETWORK. The note above asked
   * whoever owns the mainnet switch to decide whether this relay belongs behind
   * it. It does: a server with mainnet switched off must not relay a real
   * Bitcoin transaction for anyone, demo account included. The client hides
   * the mainnet entry when the flag is off; this is the half that holds when
   * the client is bypassed.
   */
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
      // Log loudly. This is the one failure in this file that can cost a user
      // money if the UI mishandles it, and it needs to be findable afterwards.
      console.error(`[btc] broadcast on ${network} was AMBIGUOUS for user ${req.user._id}. The transaction may be live.`);
    }
    return fail(res, outcome, "broadcast");
  }

  console.log(`[btc] broadcast on ${network} accepted for user ${req.user._id}: ${outcome.txid}`);
  return res.status(201).json(outcome);
}

module.exports = { balance, utxos, fees, txs, broadcast };
