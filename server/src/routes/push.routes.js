const express = require("express");
const requireAuth = require("../middleware/auth");
const { pushAction } = require("../middleware/rateLimit");
const { validate } = require("../middleware/validate");
const schemas = require("../validation/push.schemas");
const { key, vapid, subscribe, resubscribe, devices, unsubscribe, test, action } = require("../controllers/push.controller");

const router = express.Router();

router.post("/action", pushAction, validate(schemas.action), action);
router.post("/resubscribe", pushAction, validate(schemas.resubscribe), resubscribe);

router.get("/key", requireAuth, validate(schemas.none), key);
router.get("/vapid", validate(schemas.none), vapid);
router.post("/subscribe", requireAuth, validate(schemas.subscribe), subscribe);
router.get("/devices", requireAuth, validate(schemas.none), devices);
router.post("/unsubscribe", requireAuth, validate(schemas.unsubscribe), unsubscribe);
router.post("/test", requireAuth, validate(schemas.test), test);

module.exports = router;
