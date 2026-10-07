const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");

const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = "http://localhost:5173";
const OUT = path.join(__dirname, "..", "public", "docs");
const TOKEN = process.env.TOKEN;
const TOKEN2 = process.env.TOKEN2 || "";
const ONLY = process.argv[2] || "";
const SECTIONS = String(process.env.SECTIONS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const WALLET_PW = "docs-screenshots-only-1";
const PAGE = ".aw-pages > .pv:not([hidden])";
const results = { ok: [], failed: [] };

function isLocal(url) {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(String(url || ""));
}
if (!process.env.ALLOW_REMOTE) {
  const api = process.env.VITE_API_URL || "http://localhost:8000";
  if (!isLocal(BASE) || !isLocal(api)) {
    console.error(
      `Refusing to run: this script creates a wallet, issues a payment address and generates ` +
        `reminders on the account it is given, so it is for a local dev server and a throwaway ` +
        `database only. Page target is ${BASE} and the API is ${api}. Set ALLOW_REMOTE=1 if you ` +
        `genuinely mean it.`
    );
    process.exit(1);
  }
}

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

async function clickText(page, selector, text, { exact = false, index = 0 } = {}) {
  const handles = await page.$$(selector);
  let seen = 0;
  for (const h of handles) {
    const visible = await h.evaluate((e) => e.offsetParent !== null || e.getClientRects().length > 0);
    if (!visible) continue;
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
  await page.addStyleTag({ content: ".turnstile-missing { display: none !important; }" });
  await sleep(wait);
}

async function waitPage(page, timeout = 10000) {
  await page.waitForSelector(PAGE, { timeout });
}

async function goBack(page) {
  await page.evaluate(() => history.back());
  await sleep(900);
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

async function openOpenDebt(page, pattern = /Partial|Overdue|Pending/) {
  const rows = await page.$$(".debts-table tbody tr");
  for (const r of rows) {
    const status = (await r.evaluate((e) => (e.querySelector(".pill") || {}).textContent || "")) || "";
    if (pattern.test(status)) {
      await (await r.$("td:nth-child(2)")).click();
      return;
    }
  }
  await (await rows[0].$("td:nth-child(2)")).click();
}

async function createWallet(page) {
  await clickText(page, "button", "Create a wallet");
  await waitPage(page);
  await clickText(page, `${PAGE} button`, "Show recovery phrase");
  await page.waitForSelector(".mnemonic-grid", { timeout: 10000 });
  await page.click(`${PAGE} .toggle-row input[type=checkbox]`);
  await clickText(page, `${PAGE} button`, "Continue");
  await sleep(400);
  await typeInto(page, `${PAGE} input[type=password]`, WALLET_PW, { index: 0 });
  await typeInto(page, `${PAGE} input[type=password]`, WALLET_PW, { index: 1 });
  await clickText(page, `${PAGE} button[type=submit]`, "Create wallet");
  await page.waitForSelector(".mm", { timeout: 90000 });
}

async function cardWith(page, text) {
  const cards = await page.$$(".card");
  for (const c of cards) {
    const visible = await c.evaluate((e) => e.offsetParent !== null);
    if (!visible) continue;
    const t = (await c.evaluate((e) => e.textContent)) || "";
    if (t.includes(text)) return c;
  }
  return null;
}

(async () => {
  if (!TOKEN) throw new Error("TOKEN env var is required");
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--hide-scrollbars", "--lang=en-GB"],
  });

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
    await page.close();
  });

  await section("receivables", async () => {
    const page = await newPage(browser, { token: TOKEN });
    await goto(page, "/app/receivables", 5000);
    await shot(page, "receivables-overview");

    await goto(page, "/app/receivables?view=debts", 1000);
    await page.waitForSelector(".debts-table tbody tr", { timeout: 20000 });
    await sleep(2000);
    await shot(page, "receivables-debts");

    await clickText(page, "button", "Record debt");
    await waitPage(page);
    await sleep(600);
    await shot(page, "debt-record");
    await goBack(page);

    await openOpenDebt(page);
    await waitPage(page);
    await sleep(2500);
    await shot(page, "debt-detail");

    try {
      await clickText(page, `${PAGE} button`, "Record payment");
      await sleep(700);
      await page.evaluate(() => {
        const f = document.querySelector(".aw-pages > .pv:not([hidden]) form");
        if (f) f.scrollIntoView({ block: "center" });
      });
      await sleep(400);
      await shot(page, "debt-payment");
      await clickText(page, `${PAGE} button`, "Cancel");
      await sleep(400);
    } catch (e) {
      results.failed.push("debt-payment: " + e.message);
    }

    await page.evaluate(() => window.scrollTo(0, 0));
    await clickText(page, `${PAGE} .page-head-actions button`, "Generate reminder");
    await page.waitForSelector(`${PAGE} .reminder-box`, { timeout: 30000 });
    await sleep(1500);
    await page.evaluate(() => {
      const box = document.querySelector(".aw-pages > .pv:not([hidden]) .reminder-box");
      const card = box && box.closest(".card");
      if (card) window.scrollTo(0, card.getBoundingClientRect().top + window.scrollY - 72);
    });
    await sleep(500);
    await shot(page, "debt-reminder");
    await goBack(page);

    await goto(page, "/app/receivables?view=debtors", 1000);
    await page.waitForSelector(".debtors-table tbody tr", { timeout: 20000 });
    await sleep(1500);
    await shot(page, "debtors");
    const drows = await page.$$(".debtors-table tbody tr");
    await drows[0].click();
    await page.waitForSelector(`${PAGE} .timeline`, { timeout: 20000 });
    await sleep(1500);
    await shot(page, "debtor-profile");
    await clickText(page, `${PAGE} button`, "Statement");
    await page.waitForSelector(".statement", { timeout: 20000 });
    await sleep(800);
    await shot(page, "debtor-statement");
    await page.close();
  });

  await section("dark theme", async () => {
    const page = await newPage(browser, { token: TOKEN, theme: "dark" });
    await goto(page, "/app/receivables?view=debts", 1000);
    await page.waitForSelector(".debts-table tbody tr", { timeout: 20000 });
    await sleep(1500);
    await openOpenDebt(page);
    await waitPage(page);
    await sleep(2500);
    await shot(page, "theme-dark");
    await page.close();
  });

  await section("market (paper)", async () => {
    const page = await newPage(browser, { token: TOKEN });
    await goto(page, "/app/market", 7000);
    try {
      await clickText(page, "button", "Check now");
      await sleep(6000);
    } catch {}
    await page.waitForSelector(".alert-card", { timeout: 20000 }).catch(() => {});
    await shot(page, "market-alerts");
    const history = await cardWith(page, "Alert history");
    if (history) await shot(history, "market-history");

    if (await page.$(".alert-card")) {
      await clickText(page, ".alert-card button", "Buy");
      await waitPage(page);
      await sleep(600);
      await shot(page, "market-trade");
      await typeInto(page, `${PAGE} input[type=number]`, "2500");
      await sleep(400);
      await clickText(page, `${PAGE} button`, "Review buy");
      await sleep(600);
      await shot(page, "market-trade-confirm");
      await goBack(page);
    } else {
      results.failed.push("market-trade: no pending alert to open");
    }

    await goto(page, "/app/market?view=watchlist", 6000);
    await shot(page, "market-watchlist");
    await clickText(page, ".page-head-actions button", "Add watch");
    await waitPage(page);
    await sleep(800);
    await shot(page, "market-add-watch");
    await goBack(page);
    const watches = await cardWith(page, "Active watches");
    if (watches) await shot(watches, "market-watches");

    const row = await page.$(".market-table tbody tr");
    if (row) {
      await row.click();
      await waitPage(page);
      await sleep(4500);
      await shot(page, "market-coin");
      await goBack(page);
    }

    await goto(page, "/app/market?view=portfolio", 6000);
    await shot(page, "market-portfolio");
    const agent = await cardWith(page, "Market agent");
    if (agent) await shot(agent, "market-agent");
    await page.close();
  });

  await section("wallet", async () => {
    const page = await newPage(browser, { token: TOKEN });
    await goto(page, "/app/wallet", 4000);
    await shot(page, "wallet-setup");

    await clickText(page, "button", "Create a wallet");
    await waitPage(page);
    await sleep(500);
    await clickText(page, `${PAGE} button`, "Show recovery phrase");
    await page.waitForSelector(".mnemonic-grid", { timeout: 10000 });
    await page.addStyleTag({ content: ".mnemonic-grid li { filter: blur(7px); } .pk-value { filter: blur(7px); }" });
    await sleep(500);
    await shot(page, "wallet-create-phrase");
    await page.click(`${PAGE} .toggle-row input[type=checkbox]`);
    await clickText(page, `${PAGE} button`, "Continue");
    await sleep(500);
    await shot(page, "wallet-create-password");
    await goBack(page);

    await clickText(page, "button", "Import one");
    await waitPage(page);
    await sleep(500);
    await shot(page, "wallet-import");
    await goBack(page);

    await createWallet(page);
    await sleep(3000);

    await page.click(".net-trigger");
    await sleep(2500);
    await shot(page, "wallet-networks");
    await clickText(page, ".net-item", "Base", { exact: false });
    await sleep(6000);
    await shot(page, "wallet-main");

    await clickText(page, ".page-head-actions button", "Receive");
    await page.waitForSelector(`${PAGE} .receive-card`, { timeout: 10000 });
    await sleep(1200);
    await shot(page, "wallet-receive");
    await goBack(page);

    await clickText(page, ".page-head-actions button", "Send");
    await page.waitForSelector(`${PAGE} input`, { timeout: 8000 });
    await sleep(800);
    await shot(page, "wallet-send");
    await typeInto(page, `${PAGE} input`, "0x000000000000000000000000000000000000dEaD", { index: 0 });
    await typeInto(page, `${PAGE} input[type=number]`, "0.001");
    await clickText(page, `${PAGE} button`, "Review transaction");
    await sleep(6000);
    await shot(page, "wallet-send-review");

    await goBack(page);
    await clickText(page, ".page-head-actions button", "Collected");
    await sleep(4000);
    await shot(page, "wallet-collected");
    await goBack(page);

    await clickText(page, ".mm-linkish", "Import a token");
    await waitPage(page);
    await sleep(500);
    await shot(page, "wallet-import-token");
    await goBack(page);

    await clickText(page, ".mm-tabs .tab", "Activity");
    await sleep(800);
    await shot(page, "wallet-activity");
    await clickText(page, ".mm-tabs .tab", "Tokens");
    await sleep(400);

    const firstRow = await page.$(".mm-row[role=button]");
    if (firstRow) {
      await firstRow.click();
      await waitPage(page);
      await sleep(4500);
      await shot(page, "wallet-token-detail");
      await goBack(page);
    }

    await page.click(".net-trigger");
    await sleep(800);
    await clickText(page, ".net-item", "Bitcoin", { exact: false, index: 0 });
    await sleep(1500);
    await shot(page, "wallet-bitcoin-setup");
    await typeInto(page, ".aw-view input[type=password]", WALLET_PW);
    await clickText(page, ".aw-view button", "Set up Bitcoin");
    await page.waitForSelector(".mm-actions", { timeout: 60000 });
    await sleep(4000);
    await shot(page, "wallet-bitcoin");
    await clickText(page, ".mm-actions button", "Send");
    await sleep(3500);
    await shot(page, "wallet-bitcoin-send");
    await page.close();
  });

  await section("market (live)", async () => {
    if (!TOKEN2) throw new Error("TOKEN2 is required for the live section");
    const page = await newPage(browser, { token: TOKEN2 });
    await goto(page, "/app/wallet", 4000);
    if (!(await page.$(".mm"))) {
      await createWallet(page);
      await sleep(2000);
    }
    await goto(page, "/app/market?view=portfolio", 5000);
    await clickText(page, ".mode-btn", "Live wallet");
    await sleep(3000);
    try {
      await clickText(page, ".card .chip", "Base", { exact: true });
    } catch {}
    await page.waitForSelector(".live-zero-state, .live-total, .live-read-error", { timeout: 90000 });
    await sleep(2500);
    const live = await cardWith(page, "Live positions");
    if (live) await shot(live, "market-live");
    else results.failed.push("market-live: no Live positions card");
    await clickText(page, ".mode-btn", "Paper trading");
    await sleep(1500);
    await page.close();
  });

  await section("crypto payment address", async () => {
    const page = await newPage(browser, { token: TOKEN });
    await goto(page, "/app/receivables?view=debts", 1000);
    await page.waitForSelector(".debts-table tbody tr", { timeout: 20000 });
    await sleep(1500);
    await openOpenDebt(page, /Pending/);
    await waitPage(page);
    await sleep(2000);
    await clickText(page, `${PAGE} .page-head-actions button`, "Crypto payment");
    await page.waitForFunction(
      () =>
        Array.from(document.querySelectorAll(".aw-pages > .pv:not([hidden])")).some((p) =>
          /Crypto payment for/.test(p.textContent)
        ),
      { timeout: 120000 }
    );
    await page.waitForSelector(`${PAGE} .trade-quote`, { timeout: 60000 });
    await sleep(1500);
    await shot(page, "crypto-issue");

    await typeInto(page, `${PAGE} input[type=password]`, WALLET_PW);
    await clickText(page, `${PAGE} button[type=submit]`, "Create payment address");
    await page.waitForSelector(".crypto-card", { timeout: 180000 });
    await sleep(7000);
    const card = await page.$(".crypto-card");
    await card.evaluate((e) => e.scrollIntoView({ block: "start" }));
    await sleep(600);
    await shot(page, "crypto-panel");
    await page.close();
  });

  await section("settings", async () => {
    const page = await newPage(browser, { token: TOKEN });
    for (const s of ["profile", "payout", "crypto", "security", "notifications", "danger"]) {
      await goto(page, `/app/settings?section=${s}`, 2500);
      await shot(page, `settings-${s}`);
    }
    await goto(page, "/app/settings?section=wallet-backup", 2500);
    await shot(page, "settings-backup");
    await clickText(page, ".backup-option", "Reveal secret recovery phrase");
    await waitPage(page);
    await sleep(600);
    await shot(page, "settings-backup-reveal");
    await goBack(page);
    await page.close();
  });

  await section("phone", async () => {
    const page = await newPage(browser, { phone: true, token: TOKEN });
    await goto(page, "/app/receivables", 5000);
    await page.click(".aw-burger");
    await sleep(900);
    await shot(page, "phone-home");
    await page.keyboard.press("Escape");
    await sleep(500);
    await goto(page, "/app/receivables?view=debts", 1000);
    await page.waitForSelector(".debts-table tbody tr", { timeout: 20000 });
    await sleep(1500);
    await shot(page, "phone-debts");
    await openOpenDebt(page);
    await waitPage(page);
    await sleep(2000);
    await shot(page, "phone-debt-detail");
    await goBack(page);

    await goto(page, "/app/market", 7000);
    await shot(page, "phone-market");
    await goto(page, "/app/wallet", 6000);
    await shot(page, "phone-wallet");
    await goto(page, "/app/settings", 2500);
    await shot(page, "phone-settings");
    await clickText(page, ".tabs .tab", "Notifications");
    await sleep(1500);
    await shot(page, "phone-settings-section");
    await page.close();
  });

  await browser.close();
  console.log("\nOK:", results.ok.length, "FAILED:", results.failed.length);
  for (const f of results.failed) console.log("  -", f);
  if (results.failed.length > 0) process.exit(1);
})().catch((err) => {
  console.error("fatal", err);
  process.exit(1);
});
