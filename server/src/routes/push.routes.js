const express = require("express");
const requireAuth = require("../middleware/auth");
const { pushAction } = require("../middleware/rateLimit");
const { key, subscribe, unsubscribe, test, action } = require("../controllers/push.controller");

const router = express.Router();

router.post("/action", pushAction, action);

router.get("/key", requireAuth, key);
router.post("/subscribe", requireAuth, subscribe);
router.post("/unsubscribe", requireAuth, unsubscribe);
router.post("/test", requireAuth, test);

module.exports = router;
