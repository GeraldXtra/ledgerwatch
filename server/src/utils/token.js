const jwt = require("jsonwebtoken");

/**
 * Sign a session for a user. Seven days.
 *
 * `v` is the user's tokenVersion at signing time. requireAuth compares it to
 * the version stored on the account, so bumping the stored version invalidates
 * every session issued before the bump. That is what makes "change password"
 * and "reset password" actually sign the other devices out: before this, a
 * stolen token survived the very step a person takes to revoke it, for a week.
 *
 * Tokens signed before this field existed carry no `v`, which is treated as 0,
 * so nobody is signed out by the upgrade itself.
 */
function signToken(userId, tokenVersion = 0) {
  return jwt.sign({ id: userId, v: Number(tokenVersion) || 0 }, process.env.JWT_SECRET, {
    expiresIn: "7d",
  });
}

module.exports = signToken;
