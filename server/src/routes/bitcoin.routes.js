const express = require("express");
const requireAuth = require("../middleware/auth");
const bitcoin = require("../controllers/bitcoin.controller");

const router = express.Router();

/**
 * Every Bitcoin route is authenticated.
 *
 * `router.use(requireAuth)` rather than a guard per handler, so a route added
 * later is protected by default. The opposite arrangement, where each line opts
 * in, only has to be forgotten once: an unauthenticated GET here is an open
 * outbound request proxy, and an unauthenticated POST /broadcast is an open
 * transaction relay.
 *
 * The server holds no Bitcoin keys and no per user Bitcoin records. What crosses
 * these routes is a public address in, and public chain data or a public signed
 * transaction back. See bitcoin.controller.js for why that is still worth a
 * session check.
 */
router.use(requireAuth);

router.get("/balance", bitcoin.balance);
router.get("/utxos", bitcoin.utxos);
router.get("/fees", bitcoin.fees);
router.get("/txs", bitcoin.txs);
router.post("/broadcast", bitcoin.broadcast);

module.exports = router;
