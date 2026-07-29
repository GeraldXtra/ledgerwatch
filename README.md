# LedgerWatch

LedgerWatch is a single dashboard for the jobs a small business actually has: **getting
paid**, **watching the market**, and **holding funds** — powered by one backend, one
database, and one AI brain. The **Receivables** module tracks debtors from credit sales and
automates payment reminders that include your bank details, delivered over **WhatsApp and
email** (with a one-tap wa.me fallback), cancelling future reminders the moment a debt is
marked paid. The **Market Watch** module is a chat-driven crypto agent that watches live
prices, raises alerts with plain-language explanations and buy/sell suggestions, and — only
after you approve — executes trades against a **simulated** paper portfolio. The **Wallet**
module is an optional, **non-custodial, testnet-only** multi-chain wallet: keys are generated
and encrypted in your browser, and you approve and password-sign every transaction. Nothing
sends money or a real message on its own.

Optional **push notifications** (Web Push + PWA) surface a ready reminder or a fired alert
with one-tap action buttons, and the app is installable to a phone home screen.

## Human-in-the-loop by design
Every module is deliberately human-in-the-loop. The agent **prepares and suggests** —
reminder wording, trade suggestions, an unsigned transaction — but a person **approves**
every outward action. It never sends money, signs a transaction, or auto-executes a trade;
in the wallet, only your password decrypts the key to sign, and the agent never holds it.
This is a safety design, not a limitation: "one API key away from hands-free," on purpose
kept behind a human tap.

## Everything degrades gracefully
Each integration is optional and no-ops cleanly when its keys are absent — the core app
(auth, receivables, market watch, automation) always runs. No Anthropic key → template and
parser fallbacks. No Twilio → the manual WhatsApp link. No SMTP → email sends are skipped
and logged. No VAPID → in-app toasts remain. No Alchemy key → public testnet RPC.

## Stack
- **Frontend:** React + Vite, hand-rolled navy/gold design system, recharts, lucide-react,
  ethers v6 + qrcode (wallet, code-split so they load on demand)
- **Backend:** Node.js + Express (CommonJS)
- **Database:** MongoDB (Mongoose)
- **AI:** Anthropic API, proxied server-side only — the key never reaches the browser.
  Every AI feature has a no-AI fallback, so the core app works with no key at all.
- **Prices:** CoinGecko public API (cached + batched, resilient to failures/429s)
- **Messaging:** Twilio (WhatsApp) + Nodemailer (SMTP email), both lazy + graceful
- **Push:** web-push (VAPID) + a service worker with notification action buttons; PWA manifest
- **Wallet:** non-custodial ethers v6 wallet; RPC proxied through the backend behind a strict
  method allowlist so the Alchemy key never reaches the browser; testnet chains only
- **Automation:** a single interval loop runs a reminder pass and a price pass; a manual
  `POST /api/automation/run` triggers both on demand.

## Local setup (Windows-friendly)
Prerequisites: Node 18+ and MongoDB (local `mongod`, or a MongoDB Atlas connection string).

```bat
REM 1) Backend
cd server
npm install
copy .env.example .env
REM edit .env — set MONGO_URI (local default works if mongod is running) and JWT_SECRET
npm run dev
REM expect: MongoDB connected + Server on http://localhost:8000 + Automation loop started

REM 2) Seed demo data (new terminal)
cd server
npm run seed:demo -- --force

REM 3) Frontend (new terminal)
cd client
npm install
copy .env.example .env
npm run dev
REM open the printed URL (Vite default http://localhost:5173)
```
Verify the API: open http://localhost:8000/api/health → `{"status":"ok"}`.

## Demo credentials
After `npm run seed:demo -- --force`: **`demo@ledgerwatch.app` / `demo1234`** — the dashboard opens
pre-populated with debts, watches, a simulated portfolio, and a pending alert.
See [DEMO_SCRIPT.md](DEMO_SCRIPT.md) for the ~4-minute presentation flow.

## Environment variables

### `server/.env`
| Variable | Required | Example / default | Purpose |
|---|---|---|---|
| `PORT` | no | `8000` | Server port (hosts like Render inject this) |
| `MONGO_URI` | **yes** | `mongodb://127.0.0.1:27017/ledgerwatch` | MongoDB connection (local or Atlas) |
| `JWT_SECRET` | **yes** | `a-long-random-string` | Signs auth JWTs **and** short-lived push action tokens |
| `ANTHROPIC_API_KEY` | no | `sk-ant-...` | Enables AI wording; **omit for template/parser fallbacks** |
| `CLIENT_URL` | yes (prod) | `http://localhost:5173` | Allowed CORS origin(s); comma-separate multiple |
| `NODE_ENV` | no | `development` | Environment flag |
| `AUTOMATION_INTERVAL_MS` | no | `60000` | Interval loop period (lower = faster demo) |
| `TWILIO_ACCOUNT_SID` | no | `AC...` | WhatsApp sends; absent → wa.me link only |
| `TWILIO_AUTH_TOKEN` | no | — | Twilio auth token |
| `TWILIO_WHATSAPP_FROM` | no | `whatsapp:+14155238886` | Twilio sender (sandbox or approved number) |
| `SMTP_HOST` / `SMTP_PORT` | no | `smtp.gmail.com` / `587` | Email transport; absent → email skipped |
| `SMTP_USER` / `SMTP_PASS` | no | `you@gmail.com` / App Password | **Gmail needs a 16-char App Password** |
| `MAIL_FROM` | no | `LedgerWatch <you@gmail.com>` | Email From header |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | no | from `npx web-push generate-vapid-keys` | Web Push; absent → toasts only |
| `VAPID_SUBJECT` | no | `mailto:you@example.com` | Web Push contact |
| `ALCHEMY_API_KEY` | no | — | Testnet RPC; absent → public RPC fallback |
| `ENABLE_MAINNET` | no | `false` | `true` unlocks mainnet chains — **requires a security audit** |

### `client/.env`
| Variable | Required | Example | Purpose |
|---|---|---|---|
| `VITE_API_URL` | **yes** | `http://localhost:8000` | Base URL the client calls (the Render URL in prod) |

## Provider setup (all optional)

**WhatsApp (Twilio sandbox).** Create a free account at console.twilio.com → Messaging →
Try it out → **WhatsApp sandbox**. From your phone, send the shown join code (e.g.
`join <two-words>`) to the sandbox number to opt in. Set `TWILIO_ACCOUNT_SID`,
`TWILIO_AUTH_TOKEN`, and `TWILIO_WHATSAPP_FROM=whatsapp:+14155238886`. In the sandbox you can
only message numbers that have joined.

**Email (Gmail App Password).** Enable 2-Step Verification on your Google account, then create
an **App Password** (Google Account → Security → App passwords). Use that 16-character value as
`SMTP_PASS` with `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_USER=you@gmail.com`. Your
normal login password will **not** work.

**Push (VAPID).** Generate the key pair once:

```bat
npx web-push generate-vapid-keys
```

Set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT=mailto:you@example.com`, then
enable notifications from **Settings → Notifications** (the browser prompt only ever appears on
that button press, never on page load). That page also has per-type toggles and a **send test
notification** button so you can confirm delivery.

### What notifications actually do, honestly
- **Foreground vs background.** While a LedgerWatch tab is focused the service worker suppresses
  the OS notification and the app shows an in-app toast instead, so you are never told the same
  thing twice. When no window is focused you get a real OS notification.
- **Action buttons.** A market alert offers **Buy / Sell / Dismiss**. Dismiss resolves straight
  from the notification. **Buy and Sell deliberately do not trade** — they open the app on that
  alert's trade panel, because the amount and the confirmation step are mandatory. A reminder
  offers Send WhatsApp / Send Email / Dismiss, handled against authenticated endpoints.
- **Desktop** notifications need the browser to be **running**. It may be minimised or in the
  background, but if you fully quit it, nothing is delivered. This is a browser limitation, not
  a bug.
- **Android** delivers reliably once the PWA is installed to the home screen.
- **iOS 16.4+** delivers only after the PWA is **added to the home screen** — Safari tabs alone
  will not receive push.
- Push requires **HTTPS** (or `localhost` for development).
- If permission is denied or push is unsupported, the app falls back **silently** to in-app
  toasts. It never crashes and never nags.

**Wallet (Alchemy, optional).** Without a key the wallet uses public testnet RPC. For higher
limits, create an Alchemy app and set `ALCHEMY_API_KEY` — it stays server-side and is proxied,
so it never reaches the browser. Fund a testnet address from the in-app faucet links (per
chain). `ENABLE_MAINNET` stays `false`; flipping it to expose real-money chains requires a
security review first.

### Wallet security model (Phase 4)
Non-custodial and testnet-only. Keys are generated with `ethers.Wallet.createRandom()` in the
browser and encrypted with your password into an ethers **encrypted JSON keystore** (scrypt).
**Only that ciphertext is stored in `localStorage`** — the plaintext key and recovery phrase
exist transiently in memory during generate/import/sign, are never persisted, never logged, and
never placed in any request body. The server persists **only the public address**. All RPC
(including `eth_sendRawTransaction`) is proxied through `POST /api/wallet/rpc/:chainId` behind a
strict **method allowlist** — no signing method exists on the server, and disabled/mainnet
chains are rejected. You review a full summary and enter your password to sign locally; the
agent may prepare an unsigned transaction but never signs.

## Deployment
See [DEPLOY_CHECKLIST.md](DEPLOY_CHECKLIST.md) for a step-by-step Atlas → Render → Vercel
guide. **The local demo is the primary plan; deployment is a backup flex.**

## Scripts
- `server`: `npm run dev` (watch), `npm start` (prod), `npm run seed:demo -- --force` (DESTRUCTIVE: wipes+reseeds the demo account)
- `client`: `npm run dev`, `npm run build`, `npm run preview`
