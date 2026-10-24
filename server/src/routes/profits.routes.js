const express = require("express");
const requireAuth = require("../middleware/auth");
const profits = require("../controllers/profits.controller");

const router = express.Router();

router.use(requireAuth);
router.get("/", profits.list);
router.post("/:id/dismiss", profits.dismiss);

module.exports = router;
