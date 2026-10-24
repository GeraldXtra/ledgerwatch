const express = require("express");
const requireAuth = require("../middleware/auth");
const { broadcast: broadcastLimit } = require("../middleware/rateLimit");
const { balance, utxos, fees, txs, rawTx, coins, broadcast } = require("../controllers/bitcoin.controller");

const router = express.Router();

router.get("/coins", requireAuth, coins);
router.get("/balance", requireAuth, balance);
router.get("/utxos", requireAuth, utxos);
router.get("/fees", requireAuth, fees);
router.get("/txs", requireAuth, txs);
router.get("/raw", requireAuth, rawTx);
router.post("/broadcast", requireAuth, broadcastLimit, broadcast);

module.exports = router;
