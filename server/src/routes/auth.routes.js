const express = require("express");
const requireAuth = require("../middleware/auth");
const { register, login, me, updateMe } = require("../controllers/auth.controller");

const router = express.Router();

// Public
router.post("/register", register);
router.post("/login", login);

// Protected
router.get("/me", requireAuth, me);
router.patch("/me", requireAuth, updateMe);

module.exports = router;
