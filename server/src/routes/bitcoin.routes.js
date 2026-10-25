const express = require("express");
const requireAuth = require("../middleware/auth");
const { broadcast: broadcastLimit } = require("../middleware/rateLimit");
const { validate } = require("../middleware/validate");
const schemas = require("../validation/chains.schemas");
const { balance, utxos, fees, txs, rawTx, coins, broadcast } = require("../controllers/bitcoin.controller");

const router = express.Router();

router.get("/coins", requireAuth, validate(schemas.utxoCoins), coins);
router.get("/balance", requireAuth, validate(schemas.utxoRead), balance);
router.get("/utxos", requireAuth, validate(schemas.utxoRead), utxos);
router.get("/fees", requireAuth, validate(schemas.utxoRead), fees);
router.get("/txs", requireAuth, validate(schemas.utxoRead), txs);
router.get("/raw", requireAuth, validate(schemas.utxoRead), rawTx);
router.post("/broadcast", requireAuth, broadcastLimit, validate(schemas.utxoBroadcast), broadcast);

module.exports = router;
