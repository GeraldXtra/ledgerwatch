const express = require("express");
const requireAuth = require("../middleware/auth");
const { rateLimit } = require("../middleware/rateLimit");
const ramp = require("../controllers/ramp.controller");

const router = express.Router();

const sessionLimit = rateLimit({ windowMs: 10 * 60 * 1000, max: 15, name: "ramp-session", byUser: true, message: "Too many payment pages opened. Please wait a few minutes." });
const webhookLimit = rateLimit({ windowMs: 60 * 1000, max: 120, name: "ramp-webhook" });

router.post("/webhook", webhookLimit, ramp.webhook);
router.get("/status", requireAuth, ramp.status);
router.post("/session", requireAuth, sessionLimit, ramp.session);
router.get("/orders", requireAuth, ramp.orders);

module.exports = router;
