const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const accounts = require("../repositories/accounts");
const { scopedRepo } = require("../repositories/scoped");
const signToken = require("../utils/token");
const google = require("../services/googleAuth.service");
const tf = require("../services/twoFactor.service");

function bounce(res, params, app = false) {
  const hash = new URLSearchParams(params).toString();
  return res.redirect(`${google.clientBase()}/login${app ? "?return=app" : ""}#${hash}`);
}

async function googleStart(req, res) {
  const app = String(req.query.app || "") === "1";
  if (!google.googleConfigured()) {
    return bounce(res, { error: "Sign in with Google is not switched on here." }, app);
  }
  if (!google.serverBase()) {
    return bounce(res, { error: "Sign in with Google is not set up here, so Google has nowhere to send you back to." }, app);
  }
  const n = String(req.query.n || "");
  return res.redirect(google.authorizationUrl(google.NONCE_RE.test(n) ? n : "", { app }));
}

async function googleCallback(req, res) {
  let app = false;
  try {
    const { code, state, error } = req.query;
    const verified = google.verifyState(state);
    app = Boolean(verified.app);
    if (error) return bounce(res, { error: "Google sign in was cancelled." }, app);
    if (!verified.ok) {
      return bounce(res, { error: "That sign in link has expired. Please start again." }, app);
    }
    if (!code) return bounce(res, { error: "Google did not return a sign in code." }, app);

    const tokens = await google.exchangeCode(String(code));
    if (!tokens || !tokens.access_token) {
      return bounce(res, { error: "Google did not complete the sign in. Please try again." }, app);
    }
    const profile = await google.fetchProfile(tokens.access_token);
    if (!profile || !profile.sub || !profile.email || profile.email_verified !== true) {
      return bounce(
        res,
        { error: "Google has not verified that email address, so it cannot be used to sign in here." },
        app
      );
    }

    const email = String(profile.email).toLowerCase().trim();
    let user = await accounts.findByGoogleIdOrEmail(profile.sub, email);

    if (!user) {
      const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);
      try {
        user = await accounts.create({
          name: String(profile.name || email.split("@")[0]).trim(),
          email,
          passwordHash,
          emailVerified: true,
          googleId: profile.sub,
          authProvider: "google",
        });
        await scopedRepo(user._id).portfolios.create({});
      } catch (err) {
        if (err && err.code === 11000) user = await accounts.findByEmail(email);
        else throw err;
      }
    } else {
      let changed = false;

      if (!user.emailVerified && !user.googleId) {
        user.passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);
        user.tokenVersion = (Number(user.tokenVersion) || 0) + 1;
        user.emailVerification = undefined;
        changed = true;
        console.warn(
          `[oauth] Google sign-in claimed the unverified account ${user._id} (${email}). ` +
            "Its password and every existing session were invalidated."
        );
      }

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

    if (!user) return bounce(res, { error: "Could not sign you in. Please try again." }, app);
    if (user.twoFactor && user.twoFactor.enabled) {
      return bounce(res, { challenge: tf.issueChallenge(user), n: verified.nonce }, app);
    }
    return bounce(res, { token: signToken(user._id, user.tokenVersion), n: verified.nonce }, app);
  } catch (err) {
    console.error("google callback error:", err.message);
    return bounce(res, { error: "Google sign in failed. Please try again." }, app);
  }
}

module.exports = { googleStart, googleCallback };
