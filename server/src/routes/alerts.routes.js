const express = require("express");
const requireAuth = require("../middleware/auth");
const { validate } = require("../middleware/validate");
const schemas = require("../validation/market.schemas");
const { list, history, approve, dismiss, act, executed } = require("../controllers/alerts.controller");

const router = express.Router();

router.use(requireAuth);

router.get("/", validate(schemas.alertsList), list);
router.get("/history", validate(schemas.alertsList), history);
router.post("/:id/act", validate(schemas.alertAct), act);
router.patch("/:id/approve", validate(schemas.alertById), approve);
router.patch("/:id/dismiss", validate(schemas.alertById), dismiss);
router.post("/:id/executed", validate(schemas.alertExecuted), executed);

module.exports = router;
