const jwt = require("jsonwebtoken");
const User = require("../models/User");

/**
 * Protect routes with a Bearer JWT.
 * Reads `Authorization: Bearer <token>`, verifies it, loads the user (without
 * passwordHash) and attaches it as req.user. Returns 401 cleanly on any failure.
 *
 * A token also carries the tokenVersion it was signed with. If the account's
 * version has moved on since (a password change or reset), the token is
 * refused even though its signature and expiry are fine. See utils/token.js.
 */
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";

  if (!header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or malformed Authorization header" });
  }

  const token = header.slice(7).trim();
  if (!token) {
    return res.status(401).json({ error: "Missing token" });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  try {
    const user = await User.findById(decoded.id).select("-passwordHash");
    if (!user) {
      return res.status(401).json({ error: "User no longer exists" });
    }
    const current = Number(user.tokenVersion) || 0;
    const issued = Number(decoded.v) || 0;
    if (issued !== current) {
      return res.status(401).json({ error: "This session has been signed out. Please sign in again." });
    }
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: "Authentication failed" });
  }
}

module.exports = requireAuth;
