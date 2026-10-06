const jwt = require("jsonwebtoken");
const User = require("../models/User");

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
    const user = await User.findById(decoded.id).select("-passwordHash -avatarUrl");
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
