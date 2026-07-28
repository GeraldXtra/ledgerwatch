const express = require("express");
const requireAuth = require("../middleware/auth");
const { list, lookup, profile, statement } = require("../controllers/debtors.controller");

const router = express.Router();
router.use(requireAuth);

// /lookup must precede /:key so it isn't captured as a key.
router.get("/", list);
router.get("/lookup", lookup);
router.get("/:key/statement", statement);
router.get("/:key", profile);

module.exports = router;
