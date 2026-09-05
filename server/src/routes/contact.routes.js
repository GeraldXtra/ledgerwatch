const express = require("express");
const { rateLimit } = require("../middleware/rateLimit");
const { submit } = require("../controllers/contact.controller");

const router = express.Router();

/**
 * Public. Six messages an hour per address is generous for a person and a
 * ceiling for a script; the Turnstile check inside the controller is the
 * other half of the defence.
 */
const contactLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 6,
  name: "contact",
  message: "You have sent several messages in the last hour. Please wait a while before sending another.",
});

router.post("/", contactLimit, submit);

module.exports = router;
