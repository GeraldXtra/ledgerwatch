const express = require("express");
const requireAuth = require("../middleware/auth");
const { priceData } = require("../middleware/rateLimit");
const { validate } = require("../middleware/validate");
const schemas = require("../validation/market.schemas");
const { get } = require("../controllers/logos.controller");

const router = express.Router();

router.get("/", requireAuth, priceData("logos", 60), validate(schemas.logos), get);

module.exports = router;
