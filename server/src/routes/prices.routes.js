const express = require("express");
const requireAuth = require("../middleware/auth");
const { priceData } = require("../middleware/rateLimit");
const { validate } = require("../middleware/validate");
const schemas = require("../validation/market.schemas");
const { get } = require("../controllers/prices.controller");

const router = express.Router();

router.get("/", requireAuth, priceData("prices", 90), validate(schemas.prices), get);

module.exports = router;
