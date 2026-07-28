# PROJECT KICKOFF — "LedgerWatch" (working name)

> Paste this whole file as your FIRST message to Claude Code. It contains the full
> spec, stack, data models, routes, and a strict build order for a ONE-DAY build.
> Follow the build order top-to-bottom. Lock Module 1 fully working before starting Module 2.

---

## 0. WHAT WE ARE BUILDING (one platform, two modules)

A single dashboard app with two tabs that share one backend, one DB, one AI brain.

**Module 1 — Receivables Agent ("who dey owe me")**
Helps business owners / marketers track debtors from credit purchases and
automates payment reminders.

- Owner adds a debt: debtor name, phone, amount, due date, optional note.
- On the due date (and on a repeating schedule after) the system generates a
  reminder message that INCLUDES the owner's bank/account details so the debtor
  can pay.
- Owner taps **Mark as Paid** → all future reminders for that debtor/number are
  cancelled automatically.
- AI layer: drafts the reminder wording (gentle vs firm based on payment history)
  and answers questions like "who owes me the most?" / "who never pays on time?"

**Module 2 — Market Watch Agent (Web3 / crypto)**
A chat-driven agent that watches live crypto prices and helps with trading
decisions — WITHOUT touching real money.

- User (in chat) says e.g. "watch BTC, ETH, SOL".
- Backend polls live prices (CoinGecko free API, no key needed).
- When a user-defined condition hits (e.g. "alert me if BTC drops 5%"), the AI
  raises an alert, explains WHY in plain language, and SUGGESTS a buy/sell.
- User APPROVES with one tap. Trades execute against a SIMULATED portfolio
  (paper trading) — no real funds, no exchange keys.
- Chat interface answers "how are my coins doing?" and shows the sim portfolio.

**HARD RULE (both modules): human-in-the-loop.**
The agent never sends money, never signs a real transaction, never auto-executes
a real trade. It prepares/suggests; a human approves. This is a deliberate safety
design and should be stated as such in the demo.

---

## 1. STACK (chosen for fastest ship, all free tiers)

- Frontend: React + Vite, plain CSS or Tailwind. Dark, premium, editorial look.
- Backend: Node.js + Express.
- DB: MongoDB (Atlas free tier; local mongo fine for dev).
- AI: Anthropic API directly. Model: `claude-sonnet-4-6`. Key in backend .env,
  NEVER exposed to the frontend. All AI calls proxied through our own backend.
- Crypto prices: CoinGecko public API (no key).
- Reminders for demo: simulate send + log to DB + show in UI. (Real WhatsApp/SMS
  via Twilio/WhatsApp API is a POST-DEMO upgrade — stub it cleanly so it can be
  swapped in. Do NOT block the demo on external messaging setup.)
- Auth: simple email+password w/ JWT. Keep it minimal.

### 1a. ENVIRONMENT VARIABLES (server/.env)

```
PORT=5000
MONGO_URI=mongodb://127.0.0.1:27017/ledgerwatch   # or Atlas connection string
JWT_SECRET=<long-random-string>
ANTHROPIC_API_KEY=<your-anthropic-api-key>        # see note below
CLIENT_URL=http://localhost:5173                  # for CORS
NODE_ENV=development
```

client/.env: `VITE_API_URL=http://localhost:5000`

> ANTHROPIC KEY NOTE: your Claude Pro subscription powers Claude Code (the building).
> The RUNNING APP's calls to the Anthropic API need their own API key with credit,
> billed separately from the Pro chat plan. Confirm the key has credit before demo
> day, OR keep the AI features behind a graceful fallback (see section 7) so the app
> still fully works if the key is unfunded. Module 1's core (reminders, mark-paid)
> must work WITHOUT any AI — AI only drafts nicer wording; a plain template is the
> fallback.

### 1b. DEPENDENCIES

Server: express, mongoose, jsonwebtoken, bcryptjs, cors, dotenv, axios, node-cron, @anthropic-ai/sdk
Client: react, react-dom, react-router-dom, axios (+ Vite). Tailwind optional.

### 1c. CORS

Enable `cors` on the server allowing `CLIENT_URL`. All client calls go to VITE_API_URL.
This prevents the #1 first-hour blocker (cross-origin failure between Vite and Express).

---

## 2. DATA MODELS (MongoDB / Mongoose)

**User**

- name, email (unique), passwordHash
- bankDetails: { accountName, accountNumber, bankName } // used inside reminders
- createdAt

**Debt**

- userId (ref User)
- debtorName, debtorPhone
- amount (number), currency (default "NGN")
- dueDate (date)
- note (string, optional)
- status: "pending" | "paid" (default "pending")
- reminderCadenceDays (number, default 3) // how often to re-remind after due
- lastRemindedAt (date, nullable)
- history: [ { at, event } ] // e.g. "created", "reminded", "marked_paid"
- createdAt

**Reminder** (log of generated reminders — powers "cancel on paid")

- debtId (ref Debt), userId (ref User)
- messageText (string) // includes owner bank details
- scheduledFor (date)
- status: "scheduled" | "sent" | "cancelled"
- createdAt

**Watch** (a coin the user is monitoring)

- userId (ref User)
- coinId (e.g. "bitcoin"), symbol (e.g. "BTC")
- condition: { type: "drop_pct" | "rise_pct" | "price_below" | "price_above", value: number }
- active (bool, default true)
- lastTriggeredAt (date, nullable)
- createdAt

**SimTrade** (paper-trading portfolio entries)

- userId (ref User)
- coinId, symbol
- side: "buy" | "sell"
- qty (number), priceAtTrade (number)
- approvedByUser (bool) // must be true before it counts
- createdAt

**Alert** (things the agent surfaced for approval)

- userId, watchId (ref Watch)
- coinId, symbol
- message (string) // AI explanation
- suggestion: "buy" | "sell" | "hold"
- priceAtAlert (number) // price when the alert fired
- status: "pending" | "approved" | "dismissed"
- createdAt

**Portfolio** (one per user — the sim wallet)

- userId (ref User, unique)
- cashBalance (number, default 1000000) // start with ₦1,000,000 fake cash
- holdings: [ { coinId, symbol, qty, avgBuyPrice } ]
- createdAt

### 2a. SIMULATED PORTFOLIO RULES (make these explicit — do not improvise)

- Every user starts with cashBalance = 1,000,000 (fake NGN-equivalent units).
- Default trade size per approval = 10% of current cashBalance for a BUY
  (or the full holding for a SELL of that coin). Keep it a named constant
  TRADE_FRACTION = 0.10 so it is easy to change.
- BUY: qty = (cashBalance \* TRADE_FRACTION) / priceAtAlert. Subtract cost from
  cash, add/merge holding (recompute avgBuyPrice).
- SELL: qty = full holding of that coin. Add proceeds (qty \* currentPrice) to cash,
  remove the holding.
- P/L = (current value of all holdings at live price + cashBalance) - 1,000,000.
- Never allow a BUY that exceeds cashBalance, or a SELL of a coin not held.

---

## 3. API ROUTES

Auth:

- POST /api/auth/register
- POST /api/auth/login
- GET /api/auth/me

Receivables (Module 1):

- POST /api/debts create debt
- GET /api/debts list my debts (filter ?status=)
- PATCH /api/debts/:id/paid mark paid -> cancels scheduled reminders
- GET /api/debts/:id/reminders reminder log for a debt
- POST /api/debts/:id/remind generate a reminder now (AI-drafted text)
- POST /api/ai/receivables-query ask "who owes me most?" etc. (AI over user's debts)

Market Watch (Module 2):

- POST /api/watches add a coin+condition (also creatable via chat)
- GET /api/watches list my watches
- DELETE /api/watches/:id stop watching
- GET /api/prices?ids=bitcoin,ethereum live prices via CoinGecko
- GET /api/alerts pending alerts for approval
- PATCH /api/alerts/:id/approve approve -> creates SimTrade + updates Portfolio per rules 2a
- PATCH /api/alerts/:id/dismiss
- GET /api/portfolio sim portfolio: cash, holdings, live value, total P/L
- POST /api/ai/chat main agent chat (parses "watch X", answers questions)

> On register, auto-create a Portfolio for the new user (cashBalance 1,000,000).

---

## 4. THE "AUTOMATION" ENGINE

A single interval loop on the backend (node-cron or setInterval every ~60s in dev):

1. **Reminder pass:** find Debts where status=pending AND
   (dueDate <= now) AND (lastRemindedAt is null OR now - lastRemindedAt >= cadence).
   For each: generate reminder (AI text incl. bank details), write a Reminder log,
   update lastRemindedAt + history. In demo mode, "sending" = log + show in UI.

2. **Price pass:** fetch prices for all active Watch coins from CoinGecko.
   For each watch, evaluate condition against latest price (and a stored baseline).
   If condition hits and not recently triggered: create an Alert with an AI
   explanation + buy/sell suggestion. Set lastTriggeredAt.

Mark-as-paid handler must set status=paid AND update all that debt's
scheduled Reminders to status=cancelled. That is the "cancel reminder" behavior.

### 4a. COINGECKO — RATE LIMITS & CACHING (important)

CoinGecko's free tier throttles (~5-15 calls/min). To avoid 429 errors on stage:

- Cache the latest price per coin in memory with a short TTL (e.g. 30-60s). The
  price pass and the /api/prices route both read from this cache, not CoinGecko
  directly, unless the cache is stale.
- Batch all watched coins into ONE CoinGecko call:
  GET /simple/price?ids=bitcoin,ethereum,solana&vs_currencies=ngn,usd
- On a fetch failure, keep serving the last cached price (never crash the loop).

### 4b. SYMBOL → COINGECKO ID MAPPING

Users type "BTC" but CoinGecko needs "bitcoin". Keep a small hardcoded map for the
common coins (BTC->bitcoin, ETH->ethereum, SOL->solana, BNB->binancecoin,
USDT->tether, XRP->ripple, ADA->cardano, DOGE->dogecoin, and a few more). If a
symbol isn't in the map, tell the user it's unsupported rather than failing silently.

---

## 5. AI USAGE (all via backend, model claude-sonnet-4-6)

- Reminder drafting: prompt includes debtor name, amount, days overdue, owner
  bank details, and a tone flag (gentle/firm from history). Output = short message.
- Receivables Q&A: pass a compact JSON summary of the user's debts as context,
  answer the question. Return plain text.
- Market chat: system prompt defines the agent. It can (a) parse "watch BTC" style
  commands and return a structured intent the backend acts on, and (b) explain
  price moves / portfolio in plain language. Use a clear JSON-intent convention so
  the backend can act on chat commands reliably.

Keep every AI call server-side. Frontend never sees the API key.

---

## 6. STRICT BUILD ORDER (do NOT skip ahead)

1. Repo scaffold: /server and /client. Server boots, /api/health returns ok.
2. DB connect + all Mongoose models.
3. Auth (register/login/me + JWT middleware). Test with curl before UI.
4. **MODULE 1 END-TO-END FIRST** — this is the guaranteed demo:
   debts CRUD -> reminder generation -> mark paid cancels reminders.
   Build the Receivables tab UI. Get it fully working & demoable. LOCK IT.
5. Automation loop for reminders (interval). Verify reminders appear over time.
6. **MODULE 2** — watches + CoinGecko prices + alerts + approve -> sim portfolio.
   Build Market Watch tab UI + agent chat.
7. Frontend polish: one dashboard, two tabs, dark/premium editorial styling.
8. Bulletproof the LOCAL demo. Seed script with sample debts + watches so the
   demo has data instantly. THEN deploy (client->Vercel, server->Render, DB->Atlas).

Checkpoint rule: after each numbered step, run it and confirm it works before moving on.

---

## 7. DEMO-DAY SAFETY NET

- A seed script that loads 4-5 sample debtors (some overdue) and 3 watched coins,
  so the app looks alive the moment it opens.
- Local build must run offline-friendly: if CoinGecko or the AI API fails, catch
  the error and show a graceful fallback (cached last price / canned explanation)
  so nothing crashes on stage.
- Keep a short spoken demo script: (1) add a debtor, show auto-reminder w/ bank
  details, mark paid, show reminders cancel. (2) "watch BTC", trigger an alert,
  approve, show sim portfolio move. (3) one line: "auto-execution and real
  WhatsApp are one API key away — built human-in-the-loop on purpose, for safety."

---

## 7a. IF TIME RUNS SHORT — CUT IN THIS ORDER (protect the demo)

Drop from the BOTTOM of this list first. Never cut anything above what you've cut.

- (cut last) Module 1 core: add debt, auto-reminder w/ bank details, mark paid cancels. NEVER CUT.
- Deployment (Vercel/Render). A rock-solid LOCAL demo beats a broken live URL.
- AI-drafted reminder wording -> fall back to a plain text template.
- Market chat natural language -> fall back to a simple "Add Watch" form + buttons.
- AI price explanations -> fall back to a canned sentence ("BTC dropped 5% vs baseline").
- Receivables AI Q&A ("who owes most") -> fall back to a sorted table.
  So the absolute minimum demo = Module 1 fully working + Module 2 watch/alert/approve/sim
  with forms instead of chat. Everything AI is a "nice-to-have" layer on top.

## 8. FIRST INSTRUCTION TO CLAUDE CODE

"Read this kickoff fully. Then do STEP 1 and STEP 2 only: scaffold /server and
/client, boot an Express server with /api/health, connect MongoDB, and create all
Mongoose models from section 2. Stop after that and show me it running before
continuing to auth."
