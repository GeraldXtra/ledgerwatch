const express = require("express");
const requireAuth = require("../middleware/auth");
const { pushAction } = require("../middleware/rateLimit");
const { key, subscribe, unsubscribe, test, action } = require("../controllers/push.controller");

const router = express.Router();

/**
 * The action endpoint authenticates via the short-lived action token in its body
 * (a service worker cannot attach the Bearer JWT), so it sits OUTSIDE requireAuth.
 *
 * It is therefore the only unauthenticated write in the API, and it had no
 * throttle of any kind: a flood of invalid tokens cost a signature verification
 * each, and a valid one could be pressed until it expired. The token is spent on
 * first use in the controller; this is the bound in front of that.
 */
router.post("/action", pushAction, action);

// Everything else is a normal authenticated, user-scoped route.
router.get("/key", requireAuth, key);
router.post("/subscribe", requireAuth, subscribe);
router.post("/unsubscribe", requireAuth, unsubscribe);
router.post("/test", requireAuth, test);

module.exports = router;
