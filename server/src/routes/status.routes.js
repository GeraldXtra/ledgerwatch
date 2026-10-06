const express = require("express");
const { get } = require("../controllers/status.controller");

const router = express.Router();

router.get("/", get);

module.exports = router;
