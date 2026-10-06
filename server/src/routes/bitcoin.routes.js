const express = require("express");
const requireAuth = require("../middleware/auth");
const { broadcast: broadcastLimit } = require("../middleware/rateLimit");
const { balance, utxos, fees, txs, broadcast } = require("../controllers/bitcoin.controller");

const router = express.Router();

router.get("/balance", requireAuth, balance);
router.get("/utxos", requireAuth, utxos);
router.get("/fees", requireAuth, fees);
router.get("/txs", requireAuth, txs);
router.post("/broadcast", requireAuth, broadcastLimit, broadcast);

module.exports = router;
