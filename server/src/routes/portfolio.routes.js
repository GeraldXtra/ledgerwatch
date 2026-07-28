const express = require("express");
const requireAuth = require("../middleware/auth");
const { get } = require("../controllers/portfolio.controller");

const router = express.Router();
router.get("/", requireAuth, get);

module.exports = router;
