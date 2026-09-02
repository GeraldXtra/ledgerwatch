/**
 * Cloudflare Turnstile verification.
 *
 * Turnstile is the free, privacy preserving alternative to reCAPTCHA. The browser
 * renders a widget, the user interacts with it, and the widget hands back a
 * single use token. That token means nothing until this server exchanges it with
 * Cloudflare, which is the whole point: a token checked only in the browser is
 * not a check at all, because the browser is the thing being defended against.
 *
 * DEGRADES GRACEFULLY, like every other integration here. With no secret key
 * configured, verification is skipped and the app works — a local developer with
 * no Cloudflare account is not locked out of their own signup form. The trade is
 * stated plainly in the boot log rather than hidden, because a security control
 * that is silently off is worse than one that is visibly absent.
 */

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

function turnstileConfigured() {
  return Boolean(process.env.TURNSTILE_SECRET_KEY);
}

/**
 * Cloudflare's documented always-passes test secret. Treating it as configured
 * would be misleading in a status readout, so it is named here.
 */
const TEST_SECRET = "1x0000000000000000000000000000000AA";

/**
 * Exchange a widget token for a verdict.
 *
 * @returns {Promise<{ok:boolean, skipped?:boolean, reason?:string, error?:string}>}
 * Never throws. A network failure reaching Cloudflare returns ok:false with a
 * nameable reason rather than a rejected promise, so a caller cannot accidentally
 * turn an outage into a 500 on the signup form.
 */
async function verifyTurnstile(token, remoteIp) {
  if (!turnstileConfigured()) {
    return { ok: true, skipped: true, reason: "not-configured" };
  }
  if (!token) {
    return {
      ok: false,
      reason: "missing-token",
      error: "Please complete the verification box before continuing.",
    };
  }

  try {
    const axios = require("axios");
    const body = new URLSearchParams();
    body.append("secret", process.env.TURNSTILE_SECRET_KEY);
    body.append("response", token);
    if (remoteIp) body.append("remoteip", remoteIp);

    const { data } = await axios.post(VERIFY_URL, body, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 10000,
    });

    if (data && data.success) return { ok: true };

    /**
     * Cloudflare returns machine codes. Two of them are worth translating,
     * because they are the ones a real user hits and both are recoverable by
     * simply trying again — telling them "verification failed" would leave them
     * stuck on a form that would work on the next attempt.
     */
    const codes = (data && data["error-codes"]) || [];
    let message = "Verification failed. Please tick the box again.";
    if (codes.includes("timeout-or-duplicate")) {
      message = "That verification has expired or was already used. Please tick the box again.";
    } else if (codes.includes("invalid-input-response")) {
      message = "That verification could not be read. Please tick the box again.";
    } else if (codes.includes("invalid-input-secret") || codes.includes("missing-input-secret")) {
      // Ours, not theirs. Say so in the log; do not blame the user in the UI.
      console.error(`[turnstile] SERVER MISCONFIGURED: ${codes.join(", ")}. Check TURNSTILE_SECRET_KEY.`);
      message = "Verification is misconfigured on the server. Please contact support.";
    }
    return { ok: false, reason: codes[0] || "failed", error: message };
  } catch (err) {
    console.error("[turnstile] verification request failed:", err.message);
    return {
      ok: false,
      reason: "unreachable",
      error: "Could not reach the verification service. Please try again.",
    };
  }
}

function turnstileStatus() {
  const key = process.env.TURNSTILE_SECRET_KEY;
  if (!key) {
    return {
      configured: false,
      reason:
        "Turnstile is not configured, so the verification box is skipped. Set TURNSTILE_SECRET_KEY " +
        "on the server and VITE_TURNSTILE_SITE_KEY on the client to switch it on.",
    };
  }
  if (key === TEST_SECRET) {
    return {
      configured: true,
      testMode: true,
      reason: "Turnstile is using Cloudflare's always-passes TEST secret. It blocks nothing.",
    };
  }
  return { configured: true, testMode: false, reason: null };
}

module.exports = { verifyTurnstile, turnstileConfigured, turnstileStatus };
