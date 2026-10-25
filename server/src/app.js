const express = require("express");
const cors = require("cors");
const { parseQuery, rejectUnsafeInput, securityHeaders } = require("./middleware/security");
const { rateLimit } = require("./middleware/rateLimit");
const { validate } = require("./middleware/validate");
const { reportProblem } = require("./services/opsAlert.service");

const app = express();
app.disable("x-powered-by");
app.set("query parser", parseQuery);

app.set("trust proxy", 1);

app.use(securityHeaders);

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
app.use(rejectUnsafeInput);

const apiLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 600,
  name: "api",
  message: "This network is sending requests too quickly. Please wait a minute.",
});
app.use("/api", (req, res, next) => (req.path === "/health" ? next() : apiLimit(req, res, next)));

app.get("/api/health", validate({}), (req, res) => {
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
app.use("/api/profits", require("./routes/profits.routes"));
app.use("/api/payment-addresses", require("./routes/paymentAddresses.routes"));
app.use("/api/bitcoin", require("./routes/bitcoin.routes"));
app.use("/api/utxo", require("./routes/bitcoin.routes"));
app.use("/api/tron", require("./routes/tron.routes"));
app.use("/api/solana", require("./routes/solana.routes"));
app.use("/api/ton", require("./routes/ton.routes"));
app.use("/api/ramp", require("./routes/ramp.routes"));
app.use("/api/contact", require("./routes/contact.routes"));
app.use("/api/public", require("./routes/public.routes"));
app.use("/api/client-errors", require("./routes/clientErrors.routes"));

app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use((err, req, res, next) => {
  const isBodyParse = err && err.type === "entity.parse.failed";
  const isTooLarge = err && err.type === "entity.too.large";
  const isCors = err && /not allowed by CORS/.test(String(err.message || ""));
  const status = isBodyParse ? 400 : isTooLarge ? 413 : isCors ? 403 : err.status || 500;
  if (status >= 500) {
    console.error("[http] unhandled error:", err && err.message);
    reportProblem({
      area: "server",
      message: `${req.method} ${req.path} failed: ${(err && err.message) || "unknown error"}`,
      detail: err && err.stack,
    });
  }
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

module.exports = app;
