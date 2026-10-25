const express = require("express");
const requireAuth = require("../middleware/auth");
const { priceData } = require("../middleware/rateLimit");
const { validate } = require("../middleware/validate");
const schemas = require("../validation/market.schemas");
const { search, chart, top } = require("../controllers/coins.controller");

const router = express.Router();

router.use(requireAuth);

router.get("/top", priceData("top", 30), validate(schemas.coinsTop), top);
router.get("/search", priceData("search", 40), validate(schemas.coinsSearch), search);
router.get("/:id/chart", priceData("chart", 40), validate(schemas.coinsChart), chart);

module.exports = router;
