const express = require("express");
const requireAuth = require("../middleware/auth");
const { broadcast: broadcastLimit } = require("../middleware/rateLimit");
const { validate } = require("../middleware/validate");
const schemas = require("../validation/chains.schemas");
const tron = require("../controllers/tron.controller");

const router = express.Router();

router.use(requireAuth);

router.get("/account", validate(schemas.tronRead), tron.account);
router.get("/block", validate(schemas.tronRead), tron.block);
router.get("/params", validate(schemas.tronRead), tron.params);
router.get("/estimate", validate(schemas.tronRead), tron.estimate);
router.get("/tx", validate(schemas.tronRead), tron.tx);
router.get("/history", validate(schemas.tronRead), tron.history);
router.post("/broadcast", broadcastLimit, validate(schemas.tronBroadcast), tron.broadcast);

module.exports = router;
