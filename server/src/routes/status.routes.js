const express = require("express");
const { validate } = require("../middleware/validate");
const schemas = require("../validation/misc.schemas");
const { get } = require("../controllers/status.controller");

const router = express.Router();

router.get("/", validate(schemas.none), get);

module.exports = router;
