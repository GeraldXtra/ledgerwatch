const express = require("express");
const requireAuth = require("../middleware/auth");
const { validate } = require("../middleware/validate");
const schemas = require("../validation/misc.schemas");
const analytics = require("../controllers/analytics.controller");

const router = express.Router();

router.use(requireAuth);

router.get("/analytics", validate(schemas.none), analytics.get);

module.exports = router;
