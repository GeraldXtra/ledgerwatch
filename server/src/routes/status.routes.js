const express = require("express");
const { get } = require("../controllers/status.controller");

const router = express.Router();

// Public on purpose — see the note in the controller. It carries no secret and
// exists so a blank market screen can be diagnosed from a browser.
router.get("/", get);

module.exports = router;
