const express = require("express");
const requireAuth = require("../middleware/auth");
const { broadcast: broadcastLimit } = require("../middleware/rateLimit");
const tron = require("../controllers/tron.controller");

const router = express.Router();

router.use(requireAuth);
router.get("/account", tron.account);
router.get("/block", tron.block);
router.get("/params", tron.params);
router.get("/estimate", tron.estimate);
router.get("/tx", tron.tx);
router.get("/history", tron.history);
router.post("/broadcast", broadcastLimit, tron.broadcast);

module.exports = router;
