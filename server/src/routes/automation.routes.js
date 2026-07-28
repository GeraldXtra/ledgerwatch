const express = require("express");
const requireAuth = require("../middleware/auth");
const { run, status } = require("../controllers/automation.controller");

const router = express.Router();

router.post("/run", requireAuth, run);
router.get("/status", requireAuth, status);

module.exports = router;
