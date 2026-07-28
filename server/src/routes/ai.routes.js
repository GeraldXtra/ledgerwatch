const express = require("express");
const requireAuth = require("../middleware/auth");
const { receivablesQuery, chat } = require("../controllers/ai.controller");

const router = express.Router();

// Receivables Q&A (Module 1).
router.post("/receivables-query", requireAuth, receivablesQuery);
// Market agent chat (Module 2).
router.post("/chat", requireAuth, chat);

module.exports = router;
