const express = require("express");
const requireAuth = require("../middleware/auth");
const { key, subscribe, unsubscribe, action } = require("../controllers/push.controller");

const router = express.Router();

// The action endpoint authenticates via the short-lived action token in its body
// (a service worker cannot attach the Bearer JWT), so it sits OUTSIDE requireAuth.
router.post("/action", action);

// Everything else is a normal authenticated, user-scoped route.
router.get("/key", requireAuth, key);
router.post("/subscribe", requireAuth, subscribe);
router.post("/unsubscribe", requireAuth, unsubscribe);

module.exports = router;
