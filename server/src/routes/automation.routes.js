const express = require("express");
const requireAuth = require("../middleware/auth");
const { rateLimit } = require("../middleware/rateLimit");
const { run, status } = require("../controllers/automation.controller");

const router = express.Router();

const runLimit = rateLimit({ windowMs: 60 * 1000, max: 12, name: "automation-run", byUser: true });

router.post("/run", requireAuth, runLimit, run);
router.get("/status", requireAuth, status);

module.exports = router;
