require("dotenv").config();

const connectDB = require("./config/db");
const { startAutomation } = require("./services/automation");
const { initPush } = require("./services/push.service");
const { verifyEmail } = require("./services/notify.service");
const { turnstileStatus } = require("./services/turnstile.service");
const { cgStatus } = require("./services/coingecko.service");
const { normalizeCryptoSettings } = require("./services/cryptoSettings.service");

{
  const secret = String(process.env.JWT_SECRET || "");
  const placeholder = /change-me|your-|example|secret$/i.test(secret);
  if (secret.length < 32 || placeholder) {
    console.error(
      "❌ JWT_SECRET is missing, shorter than 32 characters, or still the placeholder. " +
        "Every session would be forgeable. Set a long random value and restart."
    );
    process.exit(1);
  }
}

const app = require("./app");
const { reportProblem } = require("./services/opsAlert.service");

process.on("unhandledRejection", (reason) => {
  console.error(
    "[fatal] UNHANDLED REJECTION — a promise rejected with nothing to catch it. " +
      "This is a missing try/catch in a handler or a service, and it must be fixed:",
    (reason && reason.stack) || reason
  );
  reportProblem({
    area: "server",
    message: `A promise failed with nothing to catch it: ${(reason && reason.message) || reason}`,
    detail: reason && reason.stack,
    severity: "critical",
  });
});

process.on("uncaughtException", (err) => {
  console.error(
    "[fatal] UNCAUGHT EXCEPTION — the process is continuing, but this must be fixed:",
    (err && err.stack) || err
  );
  reportProblem({
    area: "server",
    message: `An error escaped every handler: ${(err && err.message) || err}`,
    detail: err && err.stack,
    severity: "critical",
  });
});

const PORT = process.env.PORT || 8000;

connectDB()
  .then(async () => {
    await normalizeCryptoSettings();

    initPush();

    verifyEmail().catch(() => {});

    const cg = cgStatus();
    if (cg.configured) {
      console.log(`[coingecko] API key configured (${cg.plan} plan)`);
    } else {
      console.warn(
        "[coingecko] NO API KEY. Prices, coin logos, charts and coin search all " +
          "read this one upstream and will be rate limited on a hosted IP. Set " +
          "COINGECKO_API_KEY (add COINGECKO_PLAN=pro for a Pro key)."
      );
    }

    {
      const ts = turnstileStatus();
      if (!ts.configured) {
        console.warn(
          "[turnstile] OFF. TURNSTILE_SECRET_KEY is not set, so sign in and sign up are NOT " +
            "verified, even if the browser is showing a tick box."
        );
      } else if (ts.testMode) {
        console.warn("[turnstile] TEST MODE. Using Cloudflare's always-passes secret. It blocks nothing.");
      } else {
        console.log("[turnstile] ready. Sign in and sign up are verified server side.");
      }
    }

    app.listen(PORT, () => {
      console.log(`🚀 Server on http://localhost:${PORT}`);
    });
    startAutomation();
  })
  .catch((err) => {
    console.error("❌ Failed to start server:", err.message);
    process.exit(1);
  });

module.exports = app;
