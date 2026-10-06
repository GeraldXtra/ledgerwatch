const express = require("express");
const requireAuth = require("../middleware/auth");
const { priceData } = require("../middleware/rateLimit");
const { get } = require("../controllers/logos.controller");

const router = express.Router();
// Throttled per user: this route reaches the shared CoinGecko transport, whose
// circuit breaker is one value for the whole process. See middleware/rateLimit.js.
router.get("/", requireAuth, priceData("logos", 60), get);

module.exports = router;
