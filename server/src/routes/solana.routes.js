const express = require("express");
const requireAuth = require("../middleware/auth");
const { broadcast: broadcastLimit } = require("../middleware/rateLimit");
const { validate } = require("../middleware/validate");
const schemas = require("../validation/chains.schemas");
const solana = require("../controllers/solana.controller");

const router = express.Router();

router.use(requireAuth);

router.get("/account", validate(schemas.solanaRead), solana.account);
router.get("/blockhash", validate(schemas.solanaRead), solana.blockhash);
router.get("/recipient", validate(schemas.solanaRead), solana.recipient);
router.get("/priority", validate(schemas.solanaRead), solana.priority);
router.get("/status", validate(schemas.solanaRead), solana.status);
router.get("/history", validate(schemas.solanaRead), solana.history);
router.post("/send", broadcastLimit, validate(schemas.solanaSend), solana.send);

module.exports = router;
