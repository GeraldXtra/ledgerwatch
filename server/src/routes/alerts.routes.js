const express = require("express");
const requireAuth = require("../middleware/auth");
const { list, history, approve, dismiss, act } = require("../controllers/alerts.controller");

const router = express.Router();
router.use(requireAuth);

router.get("/", list);
router.get("/history", history);
// The user chooses side AND amount. Supersedes /approve, which traded a fixed
// 10% of cash on whatever the agent suggested; /approve is kept so any older
// client keeps working.
router.post("/:id/act", act);
router.patch("/:id/approve", approve);
router.patch("/:id/dismiss", dismiss);

module.exports = router;
