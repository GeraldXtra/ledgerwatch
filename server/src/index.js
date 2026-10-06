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

/**
 * THE BOOT CHECK THAT WAS MISSING.
 *
 * JWT_SECRET signs every session and every push action token. Nothing verified
 * it had been changed from the placeholder in .env.example, so a deployment
 * that forgot would have accepted, and minted, tokens anyone with the public
 * repository could forge. Refusing to start is the only honest response.
 */
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

// Behind Render's proxy the client address arrives in X-Forwarded-For. Without
// this every rate limit bucket would key on the proxy's own address.
app.set("trust proxy", 1);

/**
 * Security headers, without a dependency. Each one closes a specific door:
 *   nosniff        a response is what its content type says, never sniffed into script
 *   DENY           this API is never framed, so no clickjacking through it
 *   Referrer       a link out never leaks the path that carried a token fragment
 *   Permissions    the API grants no browser capability to anything
 *   HSTS           once seen over TLS, never plain http again (production only)
 */
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

// Allowed CORS origins: every entry in CLIENT_URL (comma-separated for multiple
// deploy URLs) plus the common local Vite ports, so dev works whichever port
// Vite picks. In production, set CLIENT_URL to the deployed client URL.
const allowedOrigins = [
  ...(process.env.CLIENT_URL || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  /**
   * LOCALHOST IN PRODUCTION.
   *
   * `docs/SECURITY.md` 4.1 item 11 says CORS allows localhost only when
   * NODE_ENV is not production. These two were unconditional, so the deployed
   * API accepted requests from a page served on the developer's own machine.
   * Kept in development, where Vite may pick either port.
   */
  ...(process.env.NODE_ENV === "production"
    ? []
    : ["http://localhost:5173", "http://localhost:5174"]),
];

/**
 * ORIGIN FIRST, THEN THE BODY. The order was the other way round.
 *
 * `express.json()` ran before the CORS check, so a request from a rejected
 * origin still had its body read and parsed before anything looked at where it
 * came from. Parsing is the expensive part, and it was the part available to
 * anyone. Registering CORS first means a disallowed origin is refused having
 * cost one string comparison.
 */
app.use(
  cors({
    origin(origin, callback) {
      // allow non-browser clients (curl, health checks) with no Origin header
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      // Generic on purpose: echoing the rejected origin into an error body is
      // a reflection of attacker supplied text.
      return callback(new Error("Origin not allowed by CORS"));
    },
  })
);

/**
 * A SMALL CEILING EVERYWHERE, AND A LARGE ONE AT THE ONE PLACE THAT NEEDS IT.
 *
 * The 3 MB limit was global, so every route in the product — sign in, the RPC
 * proxy, recording a payment — accepted a 3 MB body and parsed it before any
 * handler saw it. Only ONE route has ever needed that headroom: the avatar
 * upload, which posts a base64 data URL and whose controller enforces the real
 * 2 MB cap on the DECODED image.
 *
 * 100 kB is the express default and is far more than any other request here
 * sends. The avatar routes get the old ceiling, mounted by path so the
 * exception is visible in one line rather than implied by the absence of a rule.
 */
app.use("/api/auth/me/avatar", express.json({ limit: "3mb" }));
app.use(express.json({ limit: "100kb" }));

/**
 * HEALTH — and a health check that could not fail was not one.
 *
 * This returned `{status:"ok"}` unconditionally. It checked nothing: not the
 * database, not the automation loop. So the host's health probe, and the manual
 * "sanity check" step in DEPLOY_CHECKLIST.md, both reported a healthy server
 * while Mongo was unreachable and no invoice could settle. `ARCHITECTURE.md`
 * section 7.3 asks for exactly the two checks below.
 *
 * It reports 503 when something is genuinely wrong, because a probe that always
 * answers 200 tells an orchestrator nothing and will never restart anything.
 *
 * It stays cheap and it stays public: `readyState` is a local field, not a round
 * trip, and the body carries booleans and ages — no configuration, no
 * connection string, nothing about a user.
 */
app.get("/api/health", (req, res) => {
  const mongoose = require("mongoose");
  const { getStatus } = require("./services/automation");

  const dbUp = mongoose.connection.readyState === 1;

  const loop = getStatus();
  const intervalMs = Number(loop.intervalMs) || 60000;
  const lastRunAt = loop.lastRunAt ? new Date(loop.lastRunAt).getTime() : null;
  const ageMs = lastRunAt ? Date.now() - lastRunAt : null;

  /**
   * Three times the interval before the loop counts as stalled. One missed tick
   * is normal — a pass can overrun its own interval and the overlap guard skips
   * the next one by design. Three in a row is not.
   *
   * A loop that has never run is NOT stalled: the interval fires after the first
   * full period, so a server that started thirty seconds ago is simply young.
   */
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

// Routes
// Public, carries no secret, and exists so an empty market screen can be
// diagnosed from a browser rather than from a server log. See the controller.
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
// Public. The Contact page. Rate limited and Turnstile checked inside.
app.use("/api/contact", require("./routes/contact.routes"));

/**
 * JSON, ALWAYS. There was no 404 handler and no error handler, so an unknown
 * path returned Express's HTML "Cannot GET", a malformed JSON body returned an
 * HTML page carrying a full stack trace with the server's absolute paths, and
 * a rejected CORS origin did the same. Every client of this API speaks JSON
 * and every failure now answers in it, with nothing about the process inside.
 */
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

/**
 * THE LAST NET, AND WHY A SERVER THAT MOVES MONEY NEEDS ONE.
 *
 * Express 4 does not catch a rejected promise from an `async` route handler, and
 * Node's default since v15 is to terminate the process on an unhandled rejection.
 * Together that means one un-caught `await` anywhere in twenty-four controllers
 * takes down reminders, payment watching and the wallet proxy for every user at
 * once. That is exactly what the contact route did before it was wrapped.
 *
 * Staying up is the right call here specifically because of what this server is:
 * the payment watcher only advances its cursor on success, settlement is
 * idempotent at the database, and every pass is individually try/caught — so a
 * process that keeps running retries correctly, while a process that exits stops
 * watching addresses that are holding real money.
 *
 * It is LOUD on purpose. This is a bug report, not a shrug: anything that reaches
 * here is a missing try/catch that should be found and fixed.
 */
process.on("unhandledRejection", (reason) => {
  console.error(
    "[fatal] UNHANDLED REJECTION — a promise rejected with nothing to catch it. " +
      "This is a missing try/catch in a handler or a service, and it must be fixed:",
    (reason && reason.stack) || reason
  );
});

process.on("uncaughtException", (err) => {
  // A synchronous throw outside any handler. Same reasoning as above, except
  // the process state is less trustworthy after one of these, so it is logged
  // with more alarm. Deliberately still does not exit: see the note above.
  console.error(
    "[fatal] UNCAUGHT EXCEPTION — the process is continuing, but this must be fixed:",
    (err && err.stack) || err
  );
});

const PORT = process.env.PORT || 8000;

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

    /**
     * Say whether CoinGecko is authenticated, for the same reason as the two
     * above: unkeyed works on a laptop and is rate limited on a host, and the
     * symptom is the entire market surface going blank at once — no price, no
     * coin logos, no chart, no coin search — with nothing on screen saying why.
     */
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

    /**
     * Say plainly whether the human check is actually running.
     *
     * The widget and the verification are two separate switches: the browser
     * shows a box when the SITE key is set, and this server only checks it when
     * the SECRET key is set. Setting one without the other gives a form that
     * LOOKS defended and is not, which is worse than no widget at all because
     * nobody goes looking.
     */
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
    // Start the reminder automation loop only after Mongo is connected.
    startAutomation();
  })
  .catch((err) => {
    console.error("❌ Failed to start server:", err.message);
    process.exit(1);
  });

module.exports = app;