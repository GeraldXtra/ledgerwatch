const jwt = require("jsonwebtoken");

function signToken(userId, tokenVersion = 0) {
  return jwt.sign({ id: userId, v: Number(tokenVersion) || 0 }, process.env.JWT_SECRET, {
    expiresIn: "7d",
    algorithm: "HS256",
  });
}

module.exports = signToken;
