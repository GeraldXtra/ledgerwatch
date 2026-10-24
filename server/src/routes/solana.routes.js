const express = require("express");
const requireAuth = require("../middleware/auth");
const { broadcast: broadcastLimit } = require("../middleware/rateLimit");
const solana = require("../controllers/solana.controller");

const router = express.Router();

router.use(requireAuth);
router.get("/account", solana.account);
router.get("/blockhash", solana.blockhash);
router.get("/recipient", solana.recipient);
router.get("/priority", solana.priority);
router.get("/status", solana.status);
router.get("/history", solana.history);
router.post("/send", broadcastLimit, solana.send);

module.exports = router;
