const express = require("express");
const requireAuth = require("../middleware/auth");
const { create, list, update, remove } = require("../controllers/watches.controller");

const router = express.Router();
router.use(requireAuth);

router.post("/", create);
router.get("/", list);
router.patch("/:id", update);
router.delete("/:id", remove);

module.exports = router;
