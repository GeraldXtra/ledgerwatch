const express = require("express");
const requireAuth = require("../middleware/auth");
const { rateLimit } = require("../middleware/rateLimit");
const { run, status } = require("../controllers/automation.controller");

const router = express.Router();

// A manual pass costs RPC and price calls on the operator's keys. A person
// presses this a few times an hour; a script pressing it a hundred times a
// minute is spending somebody else's quota.
const runLimit = rateLimit({ windowMs: 60 * 1000, max: 12, name: "automation-run", byUser: true });

router.post("/run", requireAuth, runLimit, run);
router.get("/status", requireAuth, status);

module.exports = router;
