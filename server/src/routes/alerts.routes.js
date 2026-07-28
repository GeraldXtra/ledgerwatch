const express = require("express");
const requireAuth = require("../middleware/auth");
const { list, history, approve, dismiss } = require("../controllers/alerts.controller");

const router = express.Router();
router.use(requireAuth);

router.get("/", list);
router.get("/history", history);
router.patch("/:id/approve", approve);
router.patch("/:id/dismiss", dismiss);

module.exports = router;
