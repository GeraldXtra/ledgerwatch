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

// Every route is authenticated and scoped to req.user.
router.patch("/mode", requireAuth, setMode);
router.get("/tokens", requireAuth, listTokens);
// Throttled: adding a token now reads the contract before storing it, so each
// call costs three eth_calls against the operator's upstream quota.
router.post("/tokens", requireAuth, addTokenLimit, addToken);
router.delete("/tokens", requireAuth, removeToken);
// Read-only: which contract a watched coin has on one chain, verified on chain.
router.get("/resolve", requireAuth, resolveTokenLimit, resolveToken);

module.exports = router;
