require("dotenv").config();

const express = require("express");
const cors = require("cors");
const connectDB = require("./config/db");
const { startAutomation } = require("./services/automation");
const { initPush } = require("./services/push.service");
const { verifyEmail } = require("./services/notify.service");
const { normalizeCryptoSettings } = require("./services/cryptoSettings.service");

const app = express();

// Allowed CORS origins: every entry in CLIENT_URL (comma-separated for multiple
// deploy URLs) plus the common local Vite ports, so dev works whichever port
// Vite picks. In production, set CLIENT_URL to the deployed client URL.
const allowedOrigins = [
  ...(process.env.CLIENT_URL || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  "http://localhost:5173",
  "http://localhost:5174",
];

// Middleware
// Raised above the 100kb default because avatars are posted as base64 data URLs.
// The avatar controller enforces the real 2MB cap on the DECODED image, so this
// ceiling only has to clear base64's ~33% encoding overhead.
app.use(express.json({ limit: "3mb" }));
app.use(
  cors({
    origin(origin, callback) {
      // allow non-browser clients (curl, health checks) with no Origin header
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error(`Origin ${origin} not allowed by CORS`));
    },
  })
);

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// Routes
app.use("/api/auth", require("./routes/auth.routes"));
app.use("/api/debts", require("./routes/debts.routes"));
app.use("/api/debtors", require("./routes/debtors.routes"));
app.use("/api/receivables", require("./routes/receivables.routes"));
app.use("/api/ai", require("./routes/ai.routes"));
app.use("/api/automation", require("./routes/automation.routes"));
app.use("/api/watches", require("./routes/watches.routes"));
app.use("/api/prices", require("./routes/prices.routes"));
app.use("/api/markets", require("./routes/markets.routes"));
app.use("/api/coins", require("./routes/coins.routes"));
app.use("/api/alerts", require("./routes/alerts.routes"));
app.use("/api/portfolio", require("./routes/portfolio.routes"));
app.use("/api/push", require("./routes/push.routes"));
app.use("/api/wallet", require("./routes/wallet.routes"));
app.use("/api/trading", require("./routes/trading.routes"));
app.use("/api/payment-addresses", require("./routes/paymentAddresses.routes"));

const PORT = process.env.PORT || 5000;

// Connect to MongoDB, then start the server
connectDB()
  .then(async () => {
    // Idempotent, and a no-op after the first run. Must happen before the
    // automation loop so a pass never reads half-migrated settings.
    await normalizeCryptoSettings();

    // Report Web Push readiness at boot. Left lazy, a bad or missing VAPID key
    // stayed invisible until the first notification tried to send and quietly
    // did nothing.
    initPush();

    // Confirm SMTP at boot too. Both of these used to be discovered only when a
    // user was waiting on a message that never came.
    verifyEmail().catch(() => {});

    app.listen(PORT, () => {
      console.log(`🚀 Server on http://localhost:${PORT}`);
    });
    // Start the reminder automation loop only after Mongo is connected.
    startAutomation();
  })
  .catch((err) => {
    console.error("❌ Failed to start server:", err.message);
    process.exit(1);
  });

module.exports = app;