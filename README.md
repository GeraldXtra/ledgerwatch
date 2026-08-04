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
- **Messaging:** Twilio (WhatsApp) + Nodemailer (SMTP email), both lazy + graceful. The
  reminder email is a branded HTML template with the logo and any payment-address QR attached
  **inline by content id** — Gmail strips `data:` URI images, so an embedded QR would never
  render for most recipients.
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
| `MAIL_FROM` | no | `LedgerWatch <you@gmail.com>` | Email From header. **Keep the angle brackets** — a bare `LedgerWatch you@gmail.com` still sends, but the display name renders wrongly, so it is normalised on the way out |
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

**One reminder per client per cadence window.** A debt's `reminderCadenceDays` (default 3) also
acts as an anti-spam guard: the automation will not email the same client twice inside that
window, and a suppressed send is recorded as `skipped: "Already sent this cadence window"`.
**Pressing send yourself always sends** — a deliberate human action is never rate limited, and
neither is tapping an action button on a notification. Only the background pass is throttled.

**Push (VAPID).** Generate the key pair once:

```bat
npx web-push generate-vapid-keys
```

Set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT=mailto:you@example.com`, then
enable notifications from **Settings → Notifications** (the browser prompt only ever appears on
that button press, never on page load). That page also has per-type toggles and a **send test
notification** button so you can confirm delivery.

### What notifications actually do, honestly
- **Foreground vs background.** While a LedgerWatch window is **focused** the service worker
  suppresses the OS notification and the app shows an in-app toast instead, so you are never told
  the same thing twice. When no window is focused you get a real OS notification — including when
  a window is visible on a second monitor but not the one you are working in. The **test
  notification is the deliberate exception**: it always shows the OS notification, because its
  only job is to prove OS delivery works.
- **Nothing is delivered until you subscribe.** Permission alone is not enough — the browser must
  create a push subscription and the server must store it. Use **Settings → Notifications →
  Enable notifications**; the browser console logs each stage (`registering`, `activated`,
  `subscribed`, `stored on the server`) so a failure is visible rather than silent.
- **Action buttons are capped by the platform.** Chrome on desktop renders **two**
  (`Notification.maxActions`). A market alert therefore shows **Buy** and **Sell**; Dismiss is
  included in the payload and appears only where the platform allows three or more.
- **Windows Focus Assist / Do Not Disturb silently suppresses everything.** If notifications stop
  appearing with no error anywhere, check this first: Windows Settings → System → Notifications,
  and confirm your browser is allowed to send them.
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


## Crypto payments on invoices (testnet)

Each invoice can be issued its own blockchain address so a client can settle in
stablecoin. The reminder then carries both payment options: the usual bank details and
the crypto option.

**Addresses are HD derived** on a dedicated branch, `m/44'/60'/0'/2/<index>`. BIP-44 uses
change-level 0 for receive and 1 for change, so level 2 is a branch no standard wallet
touches: importing the same seed into MetaMask will never surface or spend a receivables
address. Indices come from an atomic `findOneAndUpdate({$inc})`, so two concurrent requests
can never be handed the same one, and a unique compound index backs that up. **No derived
private key
is ever stored** — keys are derived in the browser from the encrypted keystore after the
user enters their password, and discarded.

A wallet **imported from a bare private key cannot be used** for this: with no mnemonic
and no chain code, BIP-32 derivation is mathematically impossible. Re-import using the
recovery phrase to enable it.

**The token is testnet USDC, not USDT.** Tether has no official deployment on these
testnets, and the reminder tells the payer that sending anything else loses the money
permanently, so the label has to be true. Circle's testnet USDC is faucet-obtainable, so
the flow is genuinely testable. Contract addresses per chain are in
[`server/src/config/chains.js`](server/src/config/chains.js).

**Watching and settlement** run as a third pass inside the existing automation loop, so
they share its overlap guard and also fire from the manual *Check now* trigger. A transfer
is `detected` first, then `confirmed` once it is deep enough (12 blocks on Sepolia, 5 on
L2s, configurable). Settlement converts using the **rate snapshot taken when the address
was issued, never the live rate** — a payer who sent exactly what was asked must never
still appear to owe money. A transaction hash can settle only once, enforced by a unique
sparse index rather than application memory, so repeated passes, a restart mid-pass, or
the manual trigger racing the timer are all safe.

Payments in any other token are recorded and surfaced as a warning, never settled.

**Where it is in the app.** Receivables → the **Debts** table → click an invoice → **Crypto
payment** in the action row. The dialog shows the balance, the USDC amount, the rate **and how
old that rate is**, and the expiry, then asks for your wallet password. The password is checked
*before* an index is reserved, because reserving one is irreversible and a typo would waste it.
Once issued, the invoice itself shows the address with a QR and copy button, a live expiry
countdown, and progress split into **confirmed**, **incoming but unconfirmed**, and **still
needed** — so money in flight is visible before it settles, with a block explorer link on every
transaction. The debts table marks those invoices with a `USDC` chip. A read-only
`GET /api/payment-addresses/quote` backs the dialog so opening and closing it never consumes an
index.

**Sweeping** moves collected funds into your main wallet, from **Wallet → Collected** (review
and sweep several at once) or from the invoice itself. It is outbound, so it is signed locally
with your wallet password and never happens automatically. The amount is read live from the
chain rather than from the recorded total, since the two differ after a previous sweep. A
derived address holds only stablecoin and no native token, so it cannot pay for its own
transfer: the main wallet sends it gas first, as a separate transaction you approve in the same
step, buffered above the estimate so a fee rise cannot strand the funds. Batches are signed one
at a time because every gas transfer comes from the same wallet and would otherwise collide on
nonce, and one failed address never aborts the rest.

**Expiry and late payments.** At expiry an address flips to `expired` and stops taking new
payment, then stays under a **low-frequency grace watch for 30 days** so money sent late is
still found and credited. The grace watch triggers on a single balance check rather than by
walking blocks, because the gap since expiry can run to millions of blocks. A late payment
settles at the **rate snapshotted when the address was issued** — the payer sent exactly what
they were quoted — and is flagged as late everywhere it appears, so a settlement on an invoice
that looked closed is never a surprise.

**Settings** live under **Settings → Crypto payments**: turn the feature on or off, choose the
default network and how long addresses accept payment, set a sweep destination, decide whether
to be notified on detection as well as settlement, and override the confirmation depth per
chain. Depths are clamped and the UI warns when you go below the recommended one, since a
shallow depth can settle an invoice on a transaction a reorg later undoes.

## Deployment
See [DEPLOY_CHECKLIST.md](DEPLOY_CHECKLIST.md) for a step-by-step Atlas → Render → Vercel
guide. **The local demo is the primary plan; deployment is a backup flex.**

## Scripts
- `server`: `npm run dev` (watch), `npm start` (prod), `npm run seed:demo -- --force` (DESTRUCTIVE: wipes+reseeds the demo account)
- `client`: `npm run dev`, `npm run build`, `npm run preview`
