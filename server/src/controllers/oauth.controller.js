const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const Portfolio = require("../models/Portfolio");
const signToken = require("../utils/token");
const google = require("../services/googleAuth.service");

/**
 * Sends the browser back to the sign in page with the outcome in the URL
 * FRAGMENT, never the query string. A fragment is not sent to any server and
 * does not land in access logs or a proxy's history, which matters because on
 * success it carries a session token.
 */
function bounce(res, params) {
  const hash = new URLSearchParams(params).toString();
  return res.redirect(`${google.clientBase()}/login#${hash}`);
}

/** GET /api/auth/google  Start the redirect flow. */
async function googleStart(_req, res) {
  if (!google.googleConfigured()) {
    return bounce(res, { error: "Sign in with Google is not switched on for this server." });
  }
  if (!google.serverBase()) {
    return bounce(res, {
      error: "SERVER_URL is not set on the server, so Google has nowhere to send you back to.",
    });
  }
  return res.redirect(google.authorizationUrl());
}

/**
 * GET /api/auth/google/callback  Google returns here with a code.
 *
 * Finds the account by Google id, then by email, and creates one if neither
 * exists. An account created this way has a random password it does not know,
 * because a password is required by the schema and a blank one would be a
 * password anyone could type. The person can set a real one later through the
 * reset flow, at which point both ways in work.
 *
 * An existing password account with the same verified email is LINKED rather
 * than duplicated: Google has verified the mailbox, which is the same proof the
 * six digit code establishes, so the two are the same person.
 */
async function googleCallback(req, res) {
  try {
    const { code, state, error } = req.query || {};
    if (error) return bounce(res, { error: "Google sign in was cancelled." });
    if (!google.verifyState(state)) {
      return bounce(res, { error: "That sign in link has expired. Please start again." });
    }
    if (!code) return bounce(res, { error: "Google did not return a sign in code." });

    const tokens = await google.exchangeCode(String(code));
    if (!tokens || !tokens.access_token) {
      return bounce(res, { error: "Google did not complete the sign in. Please try again." });
    }
    const profile = await google.fetchProfile(tokens.access_token);
    if (!profile || !profile.sub || !profile.email || profile.email_verified !== true) {
      return bounce(res, {
        error: "Google has not verified that email address, so it cannot be used to sign in here.",
      });
    }

    const email = String(profile.email).toLowerCase().trim();
    let user = await User.findOne({ $or: [{ googleId: profile.sub }, { email }] });

    if (!user) {
      const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);
      try {
        user = await User.create({
          name: String(profile.name || email.split("@")[0]).trim(),
          email,
          passwordHash,
          emailVerified: true,
          googleId: profile.sub,
          authProvider: "google",
        });
        await Portfolio.create({ userId: user._id });
      } catch (err) {
        // Two callbacks for a brand new address at once: the unique index wins,
        // and the loser simply signs into the account the winner created.
        if (err && err.code === 11000) user = await User.findOne({ email });
        else throw err;
      }
    } else {
      let changed = false;
      if (!user.googleId) {
        user.googleId = profile.sub;
        changed = true;
      }
      if (!user.emailVerified) {
        user.emailVerified = true;
        changed = true;
      }
      if (changed) await user.save();
    }

    if (!user) return bounce(res, { error: "Could not sign you in. Please try again." });
    return bounce(res, { token: signToken(user._id) });
  } catch (err) {
    console.error("google callback error:", err.message);
    return bounce(res, { error: "Google sign in failed. Please try again." });
  }
}

module.exports = { googleStart, googleCallback };
