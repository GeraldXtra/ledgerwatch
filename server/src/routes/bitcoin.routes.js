const express = require("express");
const requireAuth = require("../middleware/auth");
const { broadcast: broadcastLimit } = require("../middleware/rateLimit");
const { balance, utxos, fees, txs, broadcast } = require("../controllers/bitcoin.controller");

const router = express.Router();

// Every route authenticated: the reads are an outbound request proxy and the
// broadcast is a transaction relay, and neither belongs to an anonymous caller.
router.get("/balance", requireAuth, balance);
router.get("/utxos", requireAuth, utxos);
router.get("/fees", requireAuth, fees);
router.get("/txs", requireAuth, txs);
// Throttled as well: a relay for real money should never see a burst.
router.post("/broadcast", requireAuth, broadcastLimit, broadcast);

module.exports = router;
