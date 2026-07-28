const express = require("express");
const requireAuth = require("../middleware/auth");
const analytics = require("../controllers/analytics.controller");

const router = express.Router();
router.use(requireAuth);

router.get("/analytics", analytics.get);

module.exports = router;
