const express = require("express");
const requireAuth = require("../middleware/auth");
const { aiCall } = require("../middleware/rateLimit");
const { receivablesQuery, chat } = require("../controllers/ai.controller");

const router = express.Router();

router.post("/receivables-query", requireAuth, aiCall, receivablesQuery);
router.post("/chat", requireAuth, aiCall, chat);

module.exports = router;
