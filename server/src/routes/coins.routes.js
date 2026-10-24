const express = require("express");
const requireAuth = require("../middleware/auth");
const { priceData } = require("../middleware/rateLimit");
const { search, chart, top } = require("../controllers/coins.controller");

const router = express.Router();
router.use(requireAuth);

router.get("/top", priceData("top", 30), top);
router.get("/search", priceData("search", 40), search);
router.get("/:id/chart", priceData("chart", 40), chart);

module.exports = router;
