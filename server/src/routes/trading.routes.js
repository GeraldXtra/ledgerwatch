const express = require("express");
const requireAuth = require("../middleware/auth");
const {
  resolveToken: resolveTokenLimit,
  addToken: addTokenLimit,
} = require("../middleware/rateLimit");
const { validate } = require("../middleware/validate");
const schemas = require("../validation/trading.schemas");
const {
  setMode,
  listTokens,
  addToken,
  removeToken,
  resolveToken,
} = require("../controllers/trading.controller");

const router = express.Router();

router.patch("/mode", requireAuth, validate(schemas.setMode), setMode);
router.get("/tokens", requireAuth, validate(schemas.listTokens), listTokens);
router.post("/tokens", requireAuth, addTokenLimit, validate(schemas.addToken), addToken);
router.delete("/tokens", requireAuth, validate(schemas.removeToken), removeToken);
router.get("/resolve", requireAuth, resolveTokenLimit, validate(schemas.resolveToken), resolveToken);

module.exports = router;
