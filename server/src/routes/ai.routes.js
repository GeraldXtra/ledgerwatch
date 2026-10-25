const express = require("express");
const requireAuth = require("../middleware/auth");
const { aiCall } = require("../middleware/rateLimit");
const { validate } = require("../middleware/validate");
const schemas = require("../validation/ai.schemas");
const { receivablesQuery, chat } = require("../controllers/ai.controller");

const router = express.Router();

router.post("/receivables-query", requireAuth, aiCall, validate(schemas.receivablesQuery), receivablesQuery);
router.post("/chat", requireAuth, aiCall, validate(schemas.chat), chat);

module.exports = router;
