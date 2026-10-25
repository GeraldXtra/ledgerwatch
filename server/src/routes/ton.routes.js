const express = require("express");
const requireAuth = require("../middleware/auth");
const { broadcast: broadcastLimit } = require("../middleware/rateLimit");
const { validate } = require("../middleware/validate");
const schemas = require("../validation/chains.schemas");
const ton = require("../controllers/ton.controller");

const router = express.Router();

router.use(requireAuth);

router.get("/account", validate(schemas.tonRead), ton.account);
router.get("/recipient", validate(schemas.tonRead), ton.recipient);
router.get("/seqno", validate(schemas.tonRead), ton.seqno);
router.get("/history", validate(schemas.tonRead), ton.history);
router.post("/send", broadcastLimit, validate(schemas.tonSend), ton.send);

module.exports = router;
