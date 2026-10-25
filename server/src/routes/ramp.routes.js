const express = require("express");
const requireAuth = require("../middleware/auth");
const { rateLimit } = require("../middleware/rateLimit");
const { validate } = require("../middleware/validate");
const schemas = require("../validation/ramp.schemas");
const ramp = require("../controllers/ramp.controller");

const router = express.Router();

const sessionLimit = rateLimit({ windowMs: 10 * 60 * 1000, max: 15, name: "ramp-session", byUser: true, message: "Too many payment pages opened. Please wait a few minutes." });
const webhookLimit = rateLimit({ windowMs: 60 * 1000, max: 120, name: "ramp-webhook" });

router.post("/webhook", webhookLimit, validate(schemas.webhook), ramp.webhook);
router.get("/status", requireAuth, validate(schemas.none), ramp.status);
router.post("/session", requireAuth, sessionLimit, validate(schemas.session), ramp.session);
router.get("/orders", requireAuth, validate(schemas.none), ramp.orders);

module.exports = router;
