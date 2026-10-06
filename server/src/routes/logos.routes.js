const express = require("express");
const requireAuth = require("../middleware/auth");
const { priceData } = require("../middleware/rateLimit");
const { get } = require("../controllers/logos.controller");

const router = express.Router();
router.get("/", requireAuth, priceData("logos", 60), get);

module.exports = router;
