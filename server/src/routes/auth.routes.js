const express = require("express");
const requireAuth = require("../middleware/auth");
const {
  register,
  login,
  me,
  updateMe,
  verifyEmailCode,
  resendVerificationCode,
} = require("../controllers/auth.controller");
const account = require("../controllers/account.controller");

const router = express.Router();

// Public
router.post("/register", register);
router.post("/login", login);
router.post("/verify-email", verifyEmailCode);
router.post("/resend-code", resendVerificationCode);

// Protected — every route below is authenticated and scoped to req.user.
router.get("/me", requireAuth, me);
router.patch("/me", requireAuth, updateMe);
router.post("/me/avatar", requireAuth, account.setAvatar);
router.delete("/me/avatar", requireAuth, account.removeAvatar);
router.post("/me/password", requireAuth, account.changePassword);
router.post("/me/clear-data", requireAuth, account.clearData);
router.delete("/me", requireAuth, account.deleteAccount);

module.exports = router;
