const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

function turnstileConfigured() {
  return Boolean(process.env.TURNSTILE_SECRET_KEY);
}

const TEST_SECRET = "1x0000000000000000000000000000000AA";

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

    const codes = (data && data["error-codes"]) || [];
    let message = "Verification failed. Please tick the box again.";
    if (codes.includes("timeout-or-duplicate")) {
      message = "That verification has expired or was already used. Please tick the box again.";
    } else if (codes.includes("invalid-input-response")) {
      message = "That verification could not be read. Please tick the box again.";
    } else if (codes.includes("invalid-input-secret") || codes.includes("missing-input-secret")) {
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
