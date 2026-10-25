const express = require("express");
const requireAuth = require("../middleware/auth");
const { authAttempt, mailSend, rateLimit } = require("../middleware/rateLimit");
const { validate } = require("../middleware/validate");
const schemas = require("../validation/auth.schemas");
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
  loginSecondFactor,
} = require("../controllers/auth.controller");
const security = require("../controllers/security.controller");
const account = require("../controllers/account.controller");
const oauth = require("../controllers/oauth.controller");

const router = express.Router();

const emailChangeMail = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 6,
  name: "email-change-mail",
  byUser: true,
  message: "Too many codes requested for a new email. Please wait an hour.",
});

router.post("/register", mailSend("register"), validate(schemas.register), register);
router.post("/login", authAttempt("login"), validate(schemas.login), login);
router.post("/login/2fa", authAttempt("login-2fa"), validate(schemas.loginSecondFactor), loginSecondFactor);
router.post("/verify-email", authAttempt("verify-email"), validate(schemas.verifyEmail), verifyEmailCode);
router.post("/resend-code", mailSend("resend-code"), validate(schemas.emailOnly), resendVerificationCode);
router.post("/forgot-password", mailSend("forgot-password"), validate(schemas.forgotPassword), forgotPassword);
router.post("/resend-reset-code", mailSend("resend-reset-code"), validate(schemas.emailOnly), resendResetCode);
router.post("/reset-password", authAttempt("reset-password"), validate(schemas.resetPassword), resetPassword);

router.get("/google", authAttempt("google"), validate(schemas.googleStart), oauth.googleStart);
router.get("/google/callback", authAttempt("google-callback"), validate(schemas.googleCallback), oauth.googleCallback);

router.get("/me", requireAuth, validate(schemas.none), me);
router.patch("/me", requireAuth, validate(schemas.updateMe), updateMe);
router.post("/me/avatar", requireAuth, validate(schemas.avatar), account.setAvatar);
router.delete("/me/avatar", requireAuth, validate(schemas.none), account.removeAvatar);
router.post("/me/password", requireAuth, authAttempt("change-password"), validate(schemas.changePassword), account.changePassword);
router.post("/me/clear-data", requireAuth, validate(schemas.none), account.clearData);
router.delete("/me", requireAuth, validate(schemas.none), account.deleteAccount);

router.get("/me/2fa", requireAuth, validate(schemas.none), security.twoFactorStatus);
router.post("/me/2fa/setup", requireAuth, authAttempt("2fa-setup"), validate(schemas.passwordOnly), security.twoFactorSetup);
router.post("/me/2fa/enable", requireAuth, authAttempt("2fa-enable"), validate(schemas.codeOnly), security.twoFactorEnable);
router.post("/me/2fa/disable", requireAuth, authAttempt("2fa-disable"), validate(schemas.passwordAndCode), security.twoFactorDisable);
router.post("/me/2fa/backup-codes", requireAuth, authAttempt("2fa-codes"), validate(schemas.codeOnly), security.twoFactorBackupCodes);

router.post("/me/email", requireAuth, emailChangeMail, authAttempt("email-change-password"), validate(schemas.emailChangeStart), security.emailChangeStart);
router.post("/me/email/confirm", requireAuth, authAttempt("email-confirm"), validate(schemas.codeOnly), security.emailChangeConfirm);
router.delete("/me/email", requireAuth, validate(schemas.none), security.emailChangeCancel);

module.exports = router;
