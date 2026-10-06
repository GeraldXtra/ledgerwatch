const express = require("express");
const requireAuth = require("../middleware/auth");
const { list, history, approve, dismiss, act, executed } = require("../controllers/alerts.controller");

const router = express.Router();
router.use(requireAuth);

router.get("/", list);
router.get("/history", history);
router.post("/:id/act", act);
router.patch("/:id/approve", approve);
router.patch("/:id/dismiss", dismiss);

router.post("/:id/executed", executed);

module.exports = router;
