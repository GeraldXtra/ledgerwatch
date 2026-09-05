/**
 * REGENERATE THE GUIDE'S SCREENSHOTS.
 *
 * Every picture under client/public/docs comes from this script, so a change
 * to the interface can be followed by a fresh set in a few minutes rather
 * than by hand. It drives a real Chrome against the LOCAL dev server and a
 * THROWAWAY database. Never point it at production: it creates a wallet,
 * issues a payment address and generates reminders on the account it is
 * given.
 *
 * How to run (from the repo root):
 *
 *   1. Seed a throwaway database and start the API against it:
 *        cd server
 *        MONGO_URI=mongodb://127.0.0.1:27017/ledgerwatch_shots node src/seed/seed.js --force
 *        MONGO_URI=mongodb://127.0.0.1:27017/ledgerwatch_shots SMTP_HOST= SMTP_USER= SMTP_PASS= \
 *          ANTHROPIC_API_KEY= TURNSTILE_SECRET_KEY= AUTOMATION_INTERVAL_MS=600000 node src/index.js
 *   2. Start the client with the human check off, so buttons are enabled in the pictures:
 *        cd client && VITE_TURNSTILE_SITE_KEY= npx vite --port 5173
 *   3. Mint a session token for demo@ledgerwatch.app in that database (utils/token.js), and
 *      a second one for any other verified account for the live trading picture.
 *   4. Install puppeteer-core somewhere on NODE_PATH (it is not a dependency of the client):
 *        mkdir /tmp/shots && cd /tmp/shots && npm i puppeteer-core@23
 *   5. Run:
 *        NODE_PATH=/tmp/shots/node_modules TOKEN=<jwt> TOKEN2=<jwt> node client/scripts/docs-screenshots.cjs
 *      SECTIONS=wallet,phone limits the run; a name substring as the first argument limits the shots.
 *      CHROME_PATH overrides the Chrome location.
 *
 * The wallet it creates is a throwaway with a fixed password and is never
 * funded. The recovery phrase step is blurred before it is captured.
 */
/**
 * Screenshots of the new interface for the user guide.
 *
 * Runs against the local dev server and a throwaway database. Every picture
 * is written to client/public/docs as WebP. Desktop pictures are 1280 wide;
 * phone pictures are 390 wide at 2x.
 *
 *   TOKEN=<jwt> node shoot.cjs [only-name-substring]
 */
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");

const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = "http://localhost:5173";
const OUT = path.join(__dirname, "..", "public", "docs");
const TOKEN = process.env.TOKEN;
const TOKEN2 = process.env.TOKEN2 || "";
const ONLY = process.argv[2] || "";
// SECTIONS=a,b limits the run to sections whose name includes one of these.
const SECTIONS = String(process.env.SECTIONS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const WALLET_PW = "docs-screenshots-only-1";
const results = { ok: [], failed: [] };

fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(target, name, opts = {}) {
  if (ONLY && !name.includes(ONLY)) return;
  const file = path.join(OUT, `${name}.webp`);
  try {
    await target.screenshot({ path: file, type: "webp", quality: 84, ...opts });
    results.ok.push(name);
    console.log("  shot", name);
  } catch (err) {
    results.failed.push(`${name}: ${err.message}`);
    console.log("  FAILED", name, err.message);
  }
}

/** Screenshot one element, or fall back to the viewport. */
async function shotEl(page, selector, name, opts = {}) {
  const el = await page.$(selector);
  if (!el) {
    results.failed.push(`${name}: no element ${selector}`);
    console.log("  FAILED", name, "no element", selector);
    return;
  }
  await shot(el, name, opts);
}

/** Click the first element matching `selector` whose text includes `text`. */
async function clickText(page, selector, text, { exact = false, index = 0 } = {}) {
  const handles = await page.$$(selector);
  let seen = 0;
  for (const h of handles) {
    const t = ((await h.evaluate((e) => e.textContent)) || "").replace(/\s+/g, " ").trim();
    const hit = exact ? t === text : t.includes(text);
    if (hit) {
      if (seen === index) {
        await h.evaluate((e) => e.scrollIntoView({ block: "center" }));
        await h.click();
        return true;
      }
      seen++;
    }
  }
  throw new Error(`no ${selector} with text "${text}"`);
}

async function typeInto(page, selector, value, { index = 0 } = {}) {
  const els = await page.$$(selector);
  const el = els[index];
  if (!el) throw new Error(`no input ${selector}[${index}]`);
  await el.click({ clickCount: 3 });
  await el.type(value, { delay: 5 });
}

async function goto(page, route, wait = 1500) {
  await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#root > *", { timeout: 30000 });
  // The "verification is switched off" box is a dev server notice that
  // production never renders; the shots should look like production.
  await page.addStyleTag({ content: ".turnstile-missing { display: none !important; }" });
  await sleep(wait);
}

async function newPage(browser, { phone = false, token = null, theme = "light" } = {}) {
  const page = await browser.newPage();
  if (phone) {
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await page.setUserAgent(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
    );
  } else {
    await page.setViewport({ width: 1280, height: 860, deviceScaleFactor: 1 });
  }
  await page.evaluateOnNewDocument(
    (t, th) => {
      try {
        if (t) localStorage.setItem("ledgerwatch_token", t);
        else localStorage.removeItem("ledgerwatch_token");
        localStorage.setItem("ledgerwatch.theme", th);
      } catch {}
    },
    token,
    theme
  );
  page.on("dialog", (d) => d.dismiss().catch(() => {}));
  page.on("pageerror", (e) => console.log("  [pageerror]", e.message));
  return page;
}

async function section(name, fn) {
  if (SECTIONS.length && !SECTIONS.some((s) => name.includes(s))) return;
  console.log(`\n== ${name}`);
  try {
    await fn();
  } catch (err) {
    results.failed.push(`${name}: ${err.message}`);
    console.log("  FAILED section", name, err.message);
  }
}

(async () => {
  if (!TOKEN) throw new Error("TOKEN env var is required");
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--hide-scrollbars", "--lang=en-GB"],
  });

  // ------------------------------------------------------------ public ----
  await section("public pages", async () => {
    const page = await newPage(browser);
    await page.setViewport({ width: 1280, height: 900 });
    await goto(page, "/", 2500);
    await shot(page, "landing");
    await goto(page, "/login", 3500);
    await shot(page, "signin");
    await clickText(page, "button", "Create an account");
    await sleep(2500);
    await shot(page, "signup");
    await goto(page, "/contact", 3500);
    await shot(page, "contact");
    await goto(page, "/docs/wallet", 2500);
    await shot(page, "docs");
    await page.close();
  });

  // ------------------------------------------------------- receivables ----
  await section("receivables", async () => {
    const page = await newPage(browser, { token: TOKEN });
    await page.setViewport({ width: 1280, height: 980 });
    await goto(page, "/app/receivables", 5000);
    await shot(page, "receivables-overview");

    // Debts tab
    await clickText(page, ".subtab", "Debts");
    await page.waitForSelector(".debts-table tbody tr", { timeout: 20000 });
    await sleep(2000);
    await shot(page, "receivables-debts");

    // Record a debt
    await clickText(page, "button", "Record debt");
    await page.waitForSelector(".modal-panel", { timeout: 10000 });
    await sleep(600);
    await shotEl(page, ".modal-panel", "debt-record");
    await page.keyboard.press("Escape");
    await sleep(500);

    // Detail: find an unpaid row (the partial one for Dangote is first by default order?)
    // Open the first row whose status is not paid.
    const rows = await page.$$(".debts-table tbody tr");
    let opened = false;
    for (const r of rows) {
      const t = (await r.evaluate((e) => e.textContent)) || "";
      if (/Partial|Overdue|Pending/i.test(t) && !/Paid\b/.test(t.replace(/Partial|Unpaid/g, ""))) {
        const cell = await r.$("td:nth-child(2)");
        await cell.click();
        opened = true;
        break;
      }
    }
    if (!opened) {
      const cell = await rows[0].$("td:nth-child(2)");
      await cell.click();
    }
    await page.waitForSelector(".modal-panel", { timeout: 10000 });
    await sleep(2500);
    await shotEl(page, ".modal-panel", "debt-detail");

    // Record payment form inside the detail
    try {
      await clickText(page, ".modal-panel button", "Record payment");
      await sleep(700);
      await shotEl(page, ".modal-panel", "debt-payment");
      await clickText(page, ".modal-panel button", "Cancel");
      await sleep(400);
    } catch (e) {
      results.failed.push("debt-payment: " + e.message);
    }

    // Generate reminder from the detail (no wallet yet, so no address prompt)
    await clickText(page, ".modal-panel button", "Generate reminder");
    await page.waitForFunction(() => document.querySelectorAll(".modal-panel").length >= 1 && document.querySelector(".reminder-box"), { timeout: 30000 });
    await sleep(1500);
    const panels = await page.$$(".modal-panel");
    await shot(panels[panels.length - 1], "debt-reminder");
    await page.keyboard.press("Escape");
    await sleep(400);
    await page.keyboard.press("Escape");
    await sleep(400);

    // Debtors tab
    await clickText(page, ".subtab", "Debtors");
    await page.waitForSelector(".debtors-table tbody tr", { timeout: 20000 });
    await sleep(1500);
    await shot(page, "debtors");
    const drows = await page.$$(".debtors-table tbody tr");
    await drows[0].click();
    await page.waitForSelector(".modal-panel .timeline", { timeout: 20000 });
    await sleep(1500);
    await shotEl(page, ".modal-panel", "debtor-profile");
    await clickText(page, ".modal-panel button", "Statement");
    await page.waitForSelector(".statement", { timeout: 20000 });
    await sleep(800);
    await shotEl(page, ".modal-panel", "debtor-statement");
    await page.keyboard.press("Escape");
    await sleep(300);
    await page.close();
  });

  // ------------------------------------------------------------- theme ----
  await section("dark theme", async () => {
    const page = await newPage(browser, { token: TOKEN, theme: "dark" });
    await page.setViewport({ width: 1280, height: 900 });
    await goto(page, "/app/receivables", 5000);
    await shot(page, "theme-dark");
    await page.close();
  });

  // ------------------------------------------------------------ market ----
  await section("market (paper)", async () => {
    const page = await newPage(browser, { token: TOKEN });
    await page.setViewport({ width: 1280, height: 1000 });
    await goto(page, "/app/market", 7000);
    // Raise the seeded alert, if the seed left one primed.
    try {
      await clickText(page, "button", "Check now");
      await sleep(6000);
    } catch {}
    await shot(page, "market-overview");

    const cards = await page.$$(".card");
    async function cardWith(text) {
      for (const c of cards) {
        const t = (await c.evaluate((e) => e.textContent)) || "";
        if (t.includes(text)) return c;
      }
      return null;
    }
    const addWatch = await cardWith("Watch a coin");
    if (addWatch) await shot(addWatch, "market-add-watch");
    const agent = await cardWith("Market agent");
    if (agent) await shot(agent, "market-agent");
    const watches = await cardWith("Active watches");
    if (watches) await shot(watches, "market-watches");
    const alerts = await cardWith("Alerts awaiting your decision");
    if (alerts) await shot(alerts, "market-alerts");
    const history = await cardWith("Alert history");
    if (history) await shot(history, "market-history");

    // Trade panel from the first pending alert.
    const alertCard = await page.$(".alert-card");
    if (alertCard) {
      await clickText(page, ".alert-card button", "Buy");
      await page.waitForSelector(".modal-panel", { timeout: 10000 });
      await sleep(600);
      await shotEl(page, ".modal-panel", "market-trade");
      await typeInto(page, ".modal-panel input[type=number]", "2500");
      await sleep(400);
      await clickText(page, ".modal-panel button", "Review");
      await sleep(600);
      await shotEl(page, ".modal-panel", "market-trade-confirm");
      await page.keyboard.press("Escape");
      await sleep(400);
    } else {
      results.failed.push("market-trade: no pending alert to open");
    }

    // Coin detail from the watchlist.
    const row = await page.$(".market-table tbody tr");
    if (row) {
      await row.click();
      await page.waitForSelector(".modal-panel", { timeout: 10000 });
      await sleep(4000);
      await shotEl(page, ".modal-panel", "market-coin");
      await page.keyboard.press("Escape");
    }
    await page.close();
  });

  // ------------------------------------------------------------ wallet ----
  await section("wallet", async () => {
    const page = await newPage(browser, { token: TOKEN });
    await page.setViewport({ width: 1280, height: 900 });
    await goto(page, "/app/wallet", 4000);
    await shot(page, "wallet-setup");
    // The sticky bar would overlay the top of a frame that has been scrolled
    // into view for an element shot. Let it scroll away for this section.
    await page.addStyleTag({ content: ".topbar { position: static !important; }" });

    // Create: the phrase step, blurred.
    await clickText(page, "button", "Create a wallet");
    await page.waitForSelector(".modal-panel", { timeout: 10000 });
    await sleep(500);
    await clickText(page, ".modal-panel button", "Show recovery phrase");
    await page.waitForSelector(".mnemonic-grid", { timeout: 10000 });
    await page.addStyleTag({ content: ".mnemonic-grid li { filter: blur(7px); } .pk-value { filter: blur(7px); }" });
    await sleep(500);
    await shotEl(page, ".modal-panel", "wallet-create-phrase");
    await page.click(".modal-panel .toggle-row input[type=checkbox]");
    await clickText(page, ".modal-panel button", "Continue");
    await sleep(500);
    await shotEl(page, ".modal-panel", "wallet-create-password");
    await page.keyboard.press("Escape");
    await sleep(500);

    // Import dialog.
    await clickText(page, "button", "Import one");
    await page.waitForSelector(".modal-panel", { timeout: 10000 });
    await sleep(500);
    await shotEl(page, ".modal-panel", "wallet-import");
    await page.keyboard.press("Escape");
    await sleep(500);

    // Really create one (throwaway, never funded).
    await clickText(page, "button", "Create a wallet");
    await page.waitForSelector(".modal-panel", { timeout: 10000 });
    await clickText(page, ".modal-panel button", "Show recovery phrase");
    await page.waitForSelector(".mnemonic-grid", { timeout: 10000 });
    await page.click(".modal-panel .toggle-row input[type=checkbox]");
    await clickText(page, ".modal-panel button", "Continue");
    await sleep(400);
    await typeInto(page, ".modal-panel input[type=password]", WALLET_PW, { index: 0 });
    await typeInto(page, ".modal-panel input[type=password]", WALLET_PW, { index: 1 });
    await clickText(page, ".modal-panel button[type=submit]", "Create wallet");
    await page.waitForSelector(".mm", { timeout: 90000 });
    await sleep(3000);

    // Pick Base, then the main view.
    await page.click(".net-trigger");
    await sleep(2500);
    await shotEl(page, ".mm-stage", "wallet-networks");
    await clickText(page, ".net-item", "Base", { exact: false });
    await sleep(6000);
    await shotEl(page, ".mm-stage", "wallet-main");

    // Receive
    await clickText(page, ".mm-action", "Receive");
    await sleep(1200);
    await shotEl(page, ".mm-drawer", "wallet-receive");

    // Send form and review. Send toggles the drawer, so make sure the form
    // is the one showing before typing into it.
    await clickText(page, ".mm-action", "Send");
    try {
      await page.waitForSelector(".mm-drawer input", { timeout: 8000 });
    } catch {
      await clickText(page, ".mm-action", "Send");
      await page.waitForSelector(".mm-drawer input", { timeout: 8000 });
    }
    await sleep(800);
    await shotEl(page, ".mm-drawer", "wallet-send");
    await typeInto(page, ".mm-drawer input", "0x000000000000000000000000000000000000dEaD", { index: 0 });
    await typeInto(page, ".mm-drawer input[type=number]", "0.001");
    await clickText(page, ".mm-drawer button", "Review transaction");
    await sleep(6000);
    await shotEl(page, ".mm-drawer", "wallet-send-review");

    // Collected
    await clickText(page, ".mm-action", "Collected");
    await sleep(4000);
    await shotEl(page, ".mm-drawer", "wallet-collected");
    await clickText(page, ".mm-action", "Collected"); // close
    await sleep(400);

    // Import a token
    await clickText(page, ".mm-linkish", "Import a token");
    await page.waitForSelector(".modal-panel", { timeout: 10000 });
    await sleep(500);
    await shotEl(page, ".modal-panel", "wallet-import-token");
    await page.keyboard.press("Escape");
    await sleep(400);

    // Activity tab
    await clickText(page, ".mm-tab", "Activity");
    await sleep(800);
    await shotEl(page, ".mm-stage", "wallet-activity");
    await clickText(page, ".mm-tab", "Tokens");
    await sleep(400);

    // Token detail (first row, the native coin)
    const firstRow = await page.$(".mm-row");
    if (firstRow) {
      await firstRow.click();
      await page.waitForSelector(".modal-panel", { timeout: 10000 });
      await sleep(4500);
      await shotEl(page, ".modal-panel", "wallet-token-detail");
      await page.keyboard.press("Escape");
      await sleep(400);
    }

    // Bitcoin
    await page.click(".net-trigger");
    await sleep(800);
    await clickText(page, ".net-item", "Bitcoin", { exact: false, index: 0 });
    await sleep(1500);
    await shotEl(page, ".mm-stage", "wallet-bitcoin-setup");
    await typeInto(page, ".mm input[type=password]", WALLET_PW);
    await clickText(page, ".mm button", "Set up Bitcoin");
    await page.waitForSelector(".mm-actions", { timeout: 60000 });
    await sleep(4000);
    await shotEl(page, ".mm-stage", "wallet-bitcoin");
    await clickText(page, ".mm-action", "Send");
    await sleep(3500);
    await shotEl(page, ".mm-stage", "wallet-bitcoin-send");
    await page.close();
  });

  // ------------------------------------------------------- market live ----
  await section("market (live)", async () => {
    // The seeded demo account is locked to paper by the server, so live mode
    // is shown from a second throwaway account with its own throwaway wallet.
    if (!TOKEN2) throw new Error("TOKEN2 is required for the live section");
    const page = await newPage(browser, { token: TOKEN2 });
    await page.setViewport({ width: 1280, height: 1000 });
    await goto(page, "/app/wallet", 4000);
    if (!(await page.$(".mm"))) {
      await clickText(page, "button", "Create a wallet");
      await page.waitForSelector(".modal-panel", { timeout: 10000 });
      await clickText(page, ".modal-panel button", "Show recovery phrase");
      await page.waitForSelector(".mnemonic-grid", { timeout: 10000 });
      await page.click(".modal-panel .toggle-row input[type=checkbox]");
      await clickText(page, ".modal-panel button", "Continue");
      await sleep(400);
      await typeInto(page, ".modal-panel input[type=password]", WALLET_PW, { index: 0 });
      await typeInto(page, ".modal-panel input[type=password]", WALLET_PW, { index: 1 });
      await clickText(page, ".modal-panel button[type=submit]", "Create wallet");
      await page.waitForSelector(".mm", { timeout: 90000 });
      await sleep(2000);
    }
    await goto(page, "/app/market", 5000);
    await clickText(page, ".mode-btn", "Live wallet");
    await sleep(3000);
    // Pick Base if the panel is asking for a network.
    try {
      await clickText(page, ".card .chip", "Base", { exact: true });
    } catch {}
    // Wait for the chain read to finish: a zero state, a total, or an error.
    await page.waitForSelector(".live-zero-state, .live-total, .live-read-error", { timeout: 90000 });
    await sleep(2500);
    const cards = await page.$$(".card");
    for (const c of cards) {
      const t = (await c.evaluate((e) => e.textContent)) || "";
      if (t.includes("Live positions")) {
        await shot(c, "market-live");
        break;
      }
    }
    // Back to paper so the account is left as the seed made it.
    await clickText(page, ".mode-btn", "Paper trading");
    await sleep(1500);
    await page.close();
  });

  // ---------------------------------------------------- crypto payments ----
  await section("crypto payment address", async () => {
    const page = await newPage(browser, { token: TOKEN });
    await page.setViewport({ width: 1280, height: 980 });
    await goto(page, "/app/receivables", 4000);
    await clickText(page, ".subtab", "Debts");
    await page.waitForSelector(".debts-table tbody tr", { timeout: 20000 });
    await sleep(1500);
    // An unpaid, non partial row: "Pending" in the status pill.
    const rows = await page.$$(".debts-table tbody tr");
    let target = null;
    for (const r of rows) {
      const t = (await r.evaluate((e) => e.textContent)) || "";
      if (/Pending/.test(t)) {
        target = r;
        break;
      }
    }
    if (!target) target = rows[0];
    await (await target.$("td:nth-child(2)")).click();
    await page.waitForSelector(".modal-panel", { timeout: 10000 });
    await sleep(2000);
    await clickText(page, ".modal-panel button", "Crypto payment");
    // The invoice dialog closes and the issue dialog takes its place. It is
    // code split and pulls in ethers, which on the dev server takes a while
    // the first time, and then it fetches a quote.
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll(".modal-panel")).some((p) => /Crypto payment for/.test(p.textContent)),
      { timeout: 120000 }
    );
    await page.waitForSelector(".modal-panel .trade-quote", { timeout: 60000 });
    await sleep(1500);
    await shotEl(page, ".modal-panel", "crypto-issue");

    // Issue it for real on the test network the account defaults to.
    await typeInto(page, ".modal-panel input[type=password]", WALLET_PW);
    await clickText(page, ".modal-panel button[type=submit]", "Create payment address");
    // Back to the invoice, now carrying the address card.
    await page.waitForSelector(".crypto-card", { timeout: 180000 });
    // Let the "address created" toast go before the picture.
    await sleep(7000);
    const card = await page.$(".crypto-card");
    await card.evaluate((e) => e.scrollIntoView({ block: "start" }));
    await sleep(600);
    await shotEl(page, ".modal-panel", "crypto-panel");
    await page.close();
  });

  // ---------------------------------------------------------- settings ----
  await section("settings", async () => {
    const page = await newPage(browser, { token: TOKEN });
    await page.setViewport({ width: 1280, height: 900 });
    for (const s of ["profile", "payout", "crypto", "security", "notifications", "danger"]) {
      await goto(page, `/app/settings?section=${s}`, 2500);
      await shotEl(page, ".settings-layout", `settings-${s}`);
    }
    await goto(page, "/app/settings?section=wallet-backup", 2500);
    await shotEl(page, ".settings-layout", "settings-backup");
    await clickText(page, ".backup-option", "Reveal secret recovery phrase");
    await page.waitForSelector(".modal-panel", { timeout: 10000 });
    await sleep(600);
    await shotEl(page, ".modal-panel", "settings-backup-reveal");
    await page.keyboard.press("Escape");
    await page.close();
  });

  // ------------------------------------------------------------- phone ----
  await section("phone", async () => {
    const page = await newPage(browser, { phone: true, token: TOKEN });
    await goto(page, "/app/receivables", 5000);
    await shot(page, "phone-home");
    await clickText(page, ".subtab", "Debts");
    await page.waitForSelector(".debts-table tbody tr", { timeout: 20000 });
    await sleep(1500);
    await shot(page, "phone-debts");
    const rows = await page.$$(".debts-table tbody tr");
    await (await rows[0].$("td:nth-child(2)")).click();
    await page.waitForSelector(".modal-panel", { timeout: 10000 });
    await sleep(2000);
    await shot(page, "phone-debt-detail");
    await page.keyboard.press("Escape");
    await sleep(400);

    await goto(page, "/app/market", 7000);
    await shot(page, "phone-market");
    await goto(page, "/app/wallet", 6000);
    await shot(page, "phone-wallet");
    try {
      await page.click(".net-trigger");
      await sleep(2000);
      await shot(page, "phone-networks");
      await page.keyboard.press("Escape");
    } catch {}
    await goto(page, "/app/settings", 2500);
    await shot(page, "phone-settings");
    await page.close();

    const pub = await newPage(browser, { phone: true });
    await goto(pub, "/", 2500);
    await shot(pub, "phone-landing");
    await goto(pub, "/login", 3500);
    await shot(pub, "phone-signin");
    await goto(pub, "/docs/receivables", 2500);
    await shot(pub, "phone-docs");
    await goto(pub, "/contact", 3000);
    await shot(pub, "phone-contact");
    await pub.close();
  });

  await browser.close();
  console.log("\nOK:", results.ok.length, "FAILED:", results.failed.length);
  for (const f of results.failed) console.log("  -", f);
})().catch((err) => {
  console.error("fatal", err);
  process.exit(1);
});
