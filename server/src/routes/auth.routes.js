const express = require("express");
const requireAuth = require("../middleware/auth");
const { authAttempt, mailSend } = require("../middleware/rateLimit");
const {
  register,
  login,
  me,
  updateMe,
  verifyEmailCode,
  resendVerificationCode,
  forgotPassword,
  resendResetCode,
  resetPassword,
} = require("../controllers/auth.controller");
const account = require("../controllers/account.controller");
const oauth = require("../controllers/oauth.controller");

const router = express.Router();

// Public. Every one of these is throttled per IP: the guessing routes because a
// password or a six digit code must not be brute forceable, the sending routes
// because they mail an address the caller chose.
router.post("/register", mailSend("register"), register);
router.post("/login", authAttempt("login"), login);
router.post("/verify-email", authAttempt("verify-email"), verifyEmailCode);
router.post("/resend-code", mailSend("resend-code"), resendVerificationCode);
router.post("/forgot-password", mailSend("forgot-password"), forgotPassword);
router.post("/resend-reset-code", mailSend("resend-reset-code"), resendResetCode);
router.post("/reset-password", authAttempt("reset-password"), resetPassword);

// Sign in with Google: out to Google, back in with a code. No script in the
// page, which is why this is a redirect flow rather than a button widget.
router.get("/google", authAttempt("google"), oauth.googleStart);
router.get("/google/callback", authAttempt("google-callback"), oauth.googleCallback);

// Protected — every route below is authenticated and scoped to req.user.
router.get("/me", requireAuth, me);
router.patch("/me", requireAuth, updateMe);
router.post("/me/avatar", requireAuth, account.setAvatar);
router.delete("/me/avatar", requireAuth, account.removeAvatar);
router.post("/me/password", requireAuth, authAttempt("change-password"), account.changePassword);
router.post("/me/clear-data", requireAuth, account.clearData);
router.delete("/me", requireAuth, account.deleteAccount);

module.exports = router;
