const express = require("express");
const requireAuth = require("../middleware/auth");
const { priceData } = require("../middleware/rateLimit");
const { validate } = require("../middleware/validate");
const schemas = require("../validation/market.schemas");
const { get } = require("../controllers/markets.controller");

const router = express.Router();

router.get("/", requireAuth, priceData("markets", 90), validate(schemas.markets), get);

module.exports = router;
