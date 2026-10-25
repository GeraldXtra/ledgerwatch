const express = require("express");
const requireAuth = require("../middleware/auth");
const { validate } = require("../middleware/validate");
const schemas = require("../validation/market.schemas");
const { create, list, update, remove } = require("../controllers/watches.controller");

const router = express.Router();

router.use(requireAuth);

router.post("/", validate(schemas.watchCreate), create);
router.get("/", validate(schemas.watchList), list);
router.patch("/:id", validate(schemas.watchUpdate), update);
router.delete("/:id", validate(schemas.watchById), remove);

module.exports = router;
