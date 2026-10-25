const express = require("express");
const requireAuth = require("../middleware/auth");
const { validate } = require("../middleware/validate");
const schemas = require("../validation/market.schemas");
const profits = require("../controllers/profits.controller");

const router = express.Router();

router.use(requireAuth);

router.get("/", validate(schemas.profitsList), profits.list);
router.post("/:id/dismiss", validate(schemas.profitById), profits.dismiss);

module.exports = router;
