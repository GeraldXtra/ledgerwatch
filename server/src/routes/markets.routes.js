const express = require("express");
const requireAuth = require("../middleware/auth");
const { get } = require("../controllers/markets.controller");

const router = express.Router();
router.get("/", requireAuth, get);

module.exports = router;
