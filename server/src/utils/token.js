const jwt = require("jsonwebtoken");

/**
 * Sign a JWT for the given user id. Expires in 7 days.
 */
function signToken(userId) {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: "7d" });
}

module.exports = signToken;
