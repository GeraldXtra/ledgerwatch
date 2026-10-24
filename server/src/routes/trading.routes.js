const express = require("express");
const requireAuth = require("../middleware/auth");
const {
  resolveToken: resolveTokenLimit,
  addToken: addTokenLimit,
} = require("../middleware/rateLimit");
const {
  setMode,
  listTokens,
  addToken,
  removeToken,
  resolveToken,
} = require("../controllers/trading.controller");

const router = express.Router();

router.patch("/mode", requireAuth, setMode);
router.get("/tokens", requireAuth, listTokens);
router.post("/tokens", requireAuth, addTokenLimit, addToken);
router.delete("/tokens", requireAuth, removeToken);
router.get("/resolve", requireAuth, resolveTokenLimit, resolveToken);

module.exports = router;
