const express = require("express");
const requireAuth = require("../middleware/auth");
const { pushAction } = require("../middleware/rateLimit");
const { key, subscribe, resubscribe, devices, unsubscribe, test, action } = require("../controllers/push.controller");

const router = express.Router();

router.post("/action", pushAction, action);
router.post("/resubscribe", pushAction, resubscribe);

router.get("/key", requireAuth, key);
router.get("/vapid", key);
router.post("/subscribe", requireAuth, subscribe);
router.get("/devices", requireAuth, devices);
router.post("/unsubscribe", requireAuth, unsubscribe);
router.post("/test", requireAuth, test);

module.exports = router;
