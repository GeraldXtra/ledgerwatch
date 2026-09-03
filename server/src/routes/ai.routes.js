const express = require("express");
const requireAuth = require("../middleware/auth");
// Third party spend is capped per user. Uncapped, one account could run the
// operator's AI bill without limit.
const { aiCall } = require("../middleware/rateLimit");
const { receivablesQuery, chat } = require("../controllers/ai.controller");

const router = express.Router();

// Receivables Q&A (Module 1).
router.post("/receivables-query", requireAuth, aiCall, receivablesQuery);
// Market agent chat (Module 2).
router.post("/chat", requireAuth, aiCall, chat);

module.exports = router;
