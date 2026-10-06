const express = require("express");
const requireAuth = require("../middleware/auth");
const { priceData } = require("../middleware/rateLimit");
const { get } = require("../controllers/portfolio.controller");

const router = express.Router();
router.get("/", requireAuth, priceData("portfolio", 60), get);

module.exports = router;
