const express = require("express");
const requireAuth = require("../middleware/auth");
const { priceData } = require("../middleware/rateLimit");
const { search, chart } = require("../controllers/coins.controller");

const router = express.Router();
router.use(requireAuth);

/**
 * Throttled per user, per route. Both of these reach the shared CoinGecko
 * transport, whose circuit breaker is one value for the whole process: an
 * unthrottled search box took prices, logos, charts and search dark for every
 * user at once. See `priceData` in middleware/rateLimit.js.
 */
// /search must be declared before /:id/chart (distinct paths, but keep it explicit).
router.get("/search", priceData("search", 40), search);
router.get("/:id/chart", priceData("chart", 40), chart);

module.exports = router;
