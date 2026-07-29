# LedgerWatch — Live Demo Script (~4 minutes)

A tight, click-by-click run. The app is already alive with seeded data, so you
open straight into a lived-in dashboard. Everything is simulated — no real money,
no real messages.

---

## PRE-DEMO CHECKLIST (do this ~10 min before, in order)

1. **Start MongoDB** — local `mongod` running, or your Atlas `MONGO_URI` set in `server/.env`.
2. **Start the server** — `cd server && npm run dev`
   Wait for: `✅ MongoDB connected` and `🚀 Server on http://localhost:8000` and
   `Automation: loop started`.
3. **Start the client** — `cd client && npm run dev` → open the printed URL (Vite default http://localhost:5173).
4. **Seed fresh — do this LAST** — `cd server && npm run seed:demo -- --force`
   Read the printed summary. This resets the demo user's data and, crucially, sets the
   guaranteed BTC watch's `lastTriggeredAt` back to null so it fires on your first pass.
5. **Confirm health** — open http://localhost:8000/api/health → `{"status":"ok"}`.
6. **Log in once** to warm the page, then log out (or just refresh) so you start clean on stage.
7. **Control the live-trigger moment (important):** the automation loop runs every
   `AUTOMATION_INTERVAL_MS` (in `server/.env`). If it's short (e.g. 15000 = 15s), the seeded
   reminders and the guaranteed BTC alert will **auto-fire within ~15s of seeding** — which
   can "spend" your on-stage trigger during setup. Two clean options:
   - **Recommended:** set `AUTOMATION_INTERVAL_MS=300000` (5 min) in `server/.env` and restart
     the server. The loop won't fire during your ~4-min demo, so **"Check now" is your
     controlled live moment.**
   - **Or** keep it short and simply **seed right before you go on** — the reminders/alert
     then appear on their own within seconds, which also reads as "look, it's automated."
   Either way the pre-seeded **pending SOL alert** is always present as an instant approve.

> Env note: make sure `CLIENT_URL` in `server/.env` matches the URL the client is served on
> (the server also auto-allows localhost:5173 and :5174, so the default just works).

**Demo credentials:** `demo@ledgerwatch.app` / `demo1234`

---

## THE FLOW

### 0. Open cold (10s)
- Land on the **Sign in** screen. "LedgerWatch is one dashboard for two jobs a small
  business actually has: getting paid, and watching the market — with an AI agent that
  prepares the work but never acts without a human."
- Sign in as the demo user. The dashboard is already populated.

### 1. Receivables — "who owes me, and chase them automatically" (90s)
- You're on the **Receivables** tab. Point at the KPI row: **Total outstanding**,
  **Overdue** (shows 2), **Collected this month**, **Active debtors**.
- In the **Debts** table, point out the two **Overdue** pills (Dangote Cement, Zenith Bank).
  "These two are past due and have never been reminded."
- Click **"Check now"** is on the Market tab — for Receivables, the automation runs on a
  timer, but to show it instantly: open the debtor's **⋯ menu → Generate reminder** on
  Dangote Cement. (Or run one backend pass — see the curl note below — to have the loop
  generate both overdue reminders at once.)
- The **Reminder** modal opens with the drafted message — note it **includes your bank
  details** so the debtor can pay. Three send buttons: **Send WhatsApp**, **Send Email**,
  **Send Both**. With Twilio/SMTP configured these deliver for real and the **delivery log**
  below shows a per-channel *Sent* chip; with no provider keys they show *Skipped* and the
  **Open in WhatsApp** button still opens a pre-filled `wa.me` chat. "Nothing is auto-sent —
  and it degrades gracefully whether or not the messaging providers are set up."
- (Optional, if you set `User.autoSend` on) mention the **Payout & reminders** dialog has an
  opt-in **Send reminders automatically** toggle (WhatsApp/Email) — off by default.
- Close the modal. On that client's row, **⋯ → Mark as paid**. The status pill flips to **Paid**
  with a soft highlight. "Marking paid automatically cancels every scheduled reminder for
  that debtor — no more nagging someone who already paid."
- (Optional) reopen a reminder on the paid debtor to show its log entry is **Cancelled**.

### 2. Market Watch — "watch prices, suggest trades, I approve" (90s)
- Switch to the **Market Watch** tab. Point at the KPI row: **Portfolio value**,
  **Total P/L** (green/red), **Cash balance**, **Active watches** — and the portfolio
  **chart** (dotted line = the ₦1,000,000 starting balance).
- In the **agent chat**, type: `watch BTC drop 0.5%` → send. The agent confirms it's now
  watching BTC. "That's a natural-language command the agent parsed into a real watch."
- Click **"Check now"** (top right). The automation runs a price pass. A **BTC alert**
  appears in **Alerts awaiting approval** with a suggestion and the price. "The agent
  found a condition hit, explained why, and suggested a buy — but it's waiting for me."
- The alert offers **Buy / Sell / Dismiss**. The agent's suggestion is shown as a
  *recommendation* — say so: "it advises, I decide." Click **Buy** (or deliberately click
  **Sell** against a buy suggestion to make the point).
- The **trade panel** opens: type an amount, or hit **25% / 50% / 75% / MAX**, toggle between
  the token amount and the USD value, and watch the live quote update. Try an amount larger
  than your cash to show it is rejected inline rather than failing silently.
- **Review** then **Confirm**. The **portfolio visibly updates**: cash drops, the holding opens,
  P/L re-animates. In **Alert history** the row shows *agent buy -> you sell* with an
  **overrode** chip when you went against the recommendation.
- Back in chat, type: `how is my portfolio?` → the agent answers in plain language over
  your real positions.

> There is also a pre-seeded **pending SOL alert** already in the list — if the live pass
> is slow or you want a guaranteed approve moment, just approve that one instead.

### 3. Wallet — "real crypto, testnet, keys never leave the browser" (60s, optional)
- Switch to the **Wallet** tab. Note the permanent **TESTNET ONLY** badge — "real chains,
  fake money, so this is safe to show live."
- Click **Create wallet**. A 12-word **recovery phrase** appears **once**; tick *I have
  written this down*, then set a password. "The key is generated and encrypted **in the
  browser** — only the encrypted keystore is stored locally, and the server only ever learns
  the **public address**."
- The wallet opens: **address + copy**, a **chain switcher** (Sepolia, Base, Arbitrum,
  Polygon Amoy, Optimism), and **balances**. Open **Receive** → a QR + the faucet link.
  Grab test funds from the faucet if you want a live balance.
- Open **Send**, enter a recipient and amount → **Review transaction**. It shows a full
  summary and the estimated gas fee, then asks for your **password**. "The agent can pre-fill
  this, but only my password decrypts the key to sign — locally. The server proxies the RPC
  behind a strict allowlist; it can never sign." Sign & send → the tx lands in **History**
  with an explorer deep link.
- (Optional) **Enable notifications** from **Payout & reminders** — when a reminder is ready
  or an alert fires, you get a push with one-tap action buttons; the app is also installable
  to a phone home screen (PWA).

### 4. Closing line (15s)
> "Getting paid, watching the market, holding funds — reminders, trades, and transactions are
> fully automated in intelligence, one API key away from hands-free. It's built
> human-in-the-loop **on purpose**, for safety: the agent prepares and suggests; a person
> approves and, for the wallet, password-signs. Nothing here sends money or a real message
> without you."

---

## Backend one-liner (optional, to fire the automation from a terminal instead of the UI)
```bat
curl.exe -s -X POST http://localhost:8000/api/auth/login -H "Content-Type: application/json" -d "{\"email\":\"demo@ledgerwatch.app\",\"password\":\"demo1234\"}"
set TOKEN=PASTE_TOKEN
curl.exe -s -X POST http://localhost:8000/api/automation/run -H "Authorization: Bearer %TOKEN%"
```
This runs BOTH passes: the two overdue debts get reminders, and the guaranteed BTC watch
fires an alert. Then refresh the UI.

## New-systems verification (Windows `curl.exe`)
With the server running and `%TOKEN%` set from the login above:
```bat
REM Messaging — manual send (graceful "skipped" if Twilio/SMTP not configured)
curl.exe -s -X POST http://localhost:8000/api/debts/%DEBT%/send -H "Authorization: Bearer %TOKEN%" -H "Content-Type: application/json" -d "{\"channels\":[\"whatsapp\",\"email\"]}"

REM Push — VAPID public key (null until VAPID_* are set); a bogus action token is rejected
curl.exe -s http://localhost:8000/api/push/key -H "Authorization: Bearer %TOKEN%"
curl.exe -s -o NUL -w "%%{http_code}\n" -X POST http://localhost:8000/api/push/action -H "Content-Type: application/json" -d "{\"token\":\"bogus\",\"action\":\"approve\"}"   REM -> 401

REM Wallet — enabled testnet chains (mainnet filtered), RPC proxy allowlist
curl.exe -s http://localhost:8000/api/wallet/chains -H "Authorization: Bearer %TOKEN%"
curl.exe -s -X POST http://localhost:8000/api/wallet/rpc/84532 -H "Authorization: Bearer %TOKEN%" -H "Content-Type: application/json" -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_blockNumber\",\"params\":[]}"
curl.exe -s -o NUL -w "%%{http_code}\n" -X POST http://localhost:8000/api/wallet/rpc/84532 -H "Authorization: Bearer %TOKEN%" -H "Content-Type: application/json" -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_accounts\",\"params\":[]}"   REM -> 403 (not on allowlist)
curl.exe -s -o NUL -w "%%{http_code}\n" -X POST http://localhost:8000/api/wallet/rpc/1 -H "Authorization: Bearer %TOKEN%" -H "Content-Type: application/json" -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_blockNumber\",\"params\":[]}"   REM -> 400 (mainnet disabled)
```
Provider setup (Twilio sandbox join code, Gmail App Password, `npx web-push generate-vapid-keys`,
Alchemy key) is documented in **README.md → Provider setup**.

## If something misbehaves on stage
- **No alert fired?** Approve the pre-seeded pending SOL alert (always present after a fresh seed).
- **Prices look off / CoinGecko slow?** The app serves cached prices and never crashes; the
  demo still works. Just proceed.
- **AI acting up / no API key?** Everything degrades gracefully to templates and the
  computed parser — the full watch → alert → approve → portfolio flow still works with zero AI.
- **Messaging/push not configured?** That's fine — sends show *Skipped* and the wa.me link
  still works; push simply stays off with in-app toasts as the fallback. Nothing errors.
- **Wallet: "Could not load balances"?** A public testnet RPC was briefly slow — hit the
  refresh icon. A brand-new address shows `0` until you use the faucet. Sends need test funds
  for amount + gas.
- **Re-seed anytime:** `cd server && npm run seed:demo -- --force` resets the demo cleanly.
