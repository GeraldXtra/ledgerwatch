const express = require("express");
const requireAuth = require("../middleware/auth");
const {
  setMode,
  listTokens,
  addToken,
  removeToken,
} = require("../controllers/trading.controller");

const router = express.Router();

// Every route is authenticated and scoped to req.user.
router.patch("/mode", requireAuth, setMode);
router.get("/tokens", requireAuth, listTokens);
router.post("/tokens", requireAuth, addToken);
router.delete("/tokens", requireAuth, removeToken);

module.exports = router;
