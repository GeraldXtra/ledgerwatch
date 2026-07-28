const express = require("express");
const requireAuth = require("../middleware/auth");
const { search, chart } = require("../controllers/coins.controller");

const router = express.Router();
router.use(requireAuth);

// /search must be declared before /:id/chart (distinct paths, but keep it explicit).
router.get("/search", search);
router.get("/:id/chart", chart);

module.exports = router;
