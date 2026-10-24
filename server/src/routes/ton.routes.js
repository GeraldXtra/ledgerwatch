const express = require("express");
const requireAuth = require("../middleware/auth");
const { broadcast: broadcastLimit } = require("../middleware/rateLimit");
const ton = require("../controllers/ton.controller");

const router = express.Router();

router.use(requireAuth);
router.get("/account", ton.account);
router.get("/recipient", ton.recipient);
router.get("/seqno", ton.seqno);
router.get("/history", ton.history);
router.post("/send", broadcastLimit, ton.send);

module.exports = router;
