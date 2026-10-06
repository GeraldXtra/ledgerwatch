require("dotenv").config();

const express = require("express");
const cors = require("cors");
const connectDB = require("./config/db");
const { startAutomation } = require("./services/automation");
const { initPush } = require("./services/push.service");
const { verifyEmail } = require("./services/notify.service");
const { turnstileStatus } = require("./services/turnstile.service");
const { cgStatus } = require("./services/coingecko.service");
const { normalizeCryptoSettings } = require("./services/cryptoSettings.service");

const app = express();

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

app.set("trust proxy", 1);

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");
  if (process.env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
});

const allowedOrigins = [
  ...(process.env.CLIENT_URL || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  ...(process.env.NODE_ENV === "production"
    ? []
    : ["http://localhost:5173", "http://localhost:5174"]),
];

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error("Origin not allowed by CORS"));
    },
  })
);

app.use("/api/auth/me/avatar", express.json({ limit: "3mb" }));
app.use(express.json({ limit: "100kb" }));

app.get("/api/health", (req, res) => {
  const mongoose = require("mongoose");
  const { getStatus } = require("./services/automation");

  const dbUp = mongoose.connection.readyState === 1;

  const loop = getStatus();
  const intervalMs = Number(loop.intervalMs) || 60000;
  const lastRunAt = loop.lastRunAt ? new Date(loop.lastRunAt).getTime() : null;
  const ageMs = lastRunAt ? Date.now() - lastRunAt : null;

  const loopStalled =
    loop.active && ageMs !== null && ageMs > intervalMs * 3;

  const ok = dbUp && !loopStalled;

  return res.status(ok ? 200 : 503).json({
    status: ok ? "ok" : "degraded",
    database: dbUp ? "up" : "down",
    automation: {
      active: Boolean(loop.active),
      running: Boolean(loop.isRunning),
      intervalMs,
      lastRunSecondsAgo: ageMs === null ? null : Math.round(ageMs / 1000),
      stalled: loopStalled,
    },
  });
});

app.use("/api/status", require("./routes/status.routes"));
app.use("/api/auth", require("./routes/auth.routes"));
app.use("/api/debts", require("./routes/debts.routes"));
app.use("/api/debtors", require("./routes/debtors.routes"));
app.use("/api/receivables", require("./routes/receivables.routes"));
app.use("/api/ai", require("./routes/ai.routes"));
app.use("/api/automation", require("./routes/automation.routes"));
app.use("/api/watches", require("./routes/watches.routes"));
app.use("/api/prices", require("./routes/prices.routes"));
app.use("/api/markets", require("./routes/markets.routes"));
app.use("/api/logos", require("./routes/logos.routes"));
app.use("/api/coins", require("./routes/coins.routes"));
app.use("/api/alerts", require("./routes/alerts.routes"));
app.use("/api/portfolio", require("./routes/portfolio.routes"));
app.use("/api/push", require("./routes/push.routes"));
app.use("/api/wallet", require("./routes/wallet.routes"));
app.use("/api/trading", require("./routes/trading.routes"));
app.use("/api/payment-addresses", require("./routes/paymentAddresses.routes"));
app.use("/api/bitcoin", require("./routes/bitcoin.routes"));
app.use("/api/contact", require("./routes/contact.routes"));

app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

 
app.use((err, req, res, next) => {
  const isBodyParse = err && err.type === "entity.parse.failed";
  const isTooLarge = err && err.type === "entity.too.large";
  const isCors = err && /not allowed by CORS/.test(String(err.message || ""));
  const status = isBodyParse ? 400 : isTooLarge ? 413 : isCors ? 403 : err.status || 500;
  if (status >= 500) console.error("[http] unhandled error:", err && err.message);
  res.status(status).json({
    error: isBodyParse
      ? "The request body is not valid JSON"
      : isTooLarge
        ? "The request body is too large"
        : isCors
          ? "Origin not allowed"
          : status >= 500
            ? "Something went wrong"
            : String(err.message || "Request failed"),
  });
});

process.on("unhandledRejection", (reason) => {
  console.error(
    "[fatal] UNHANDLED REJECTION — a promise rejected with nothing to catch it. " +
      "This is a missing try/catch in a handler or a service, and it must be fixed:",
    (reason && reason.stack) || reason
  );
});

process.on("uncaughtException", (err) => {
  console.error(
    "[fatal] UNCAUGHT EXCEPTION — the process is continuing, but this must be fixed:",
    (err && err.stack) || err
  );
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