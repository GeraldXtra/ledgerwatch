const express = require("express");
const requireAuth = require("../middleware/auth");
const { priceData } = require("../middleware/rateLimit");
const { get } = require("../controllers/markets.controller");

const router = express.Router();
router.get("/", requireAuth, priceData("markets", 90), get);

module.exports = router;
