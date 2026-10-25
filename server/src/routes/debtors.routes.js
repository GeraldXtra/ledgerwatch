const express = require("express");
const requireAuth = require("../middleware/auth");
const { validate } = require("../middleware/validate");
const schemas = require("../validation/debtors.schemas");
const { list, lookup, profile, statement } = require("../controllers/debtors.controller");

const router = express.Router();

router.use(requireAuth);

router.get("/", validate(schemas.list), list);
router.get("/lookup", validate(schemas.lookup), lookup);
router.get("/:key/statement", validate(schemas.byKey), statement);
router.get("/:key", validate(schemas.byKey), profile);

module.exports = router;
