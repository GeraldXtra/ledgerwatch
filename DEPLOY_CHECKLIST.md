# LedgerWatch — Deployment Checklist

Prepare-only guide. Run these steps yourself; nothing here deploys automatically.
Free tiers throughout: **MongoDB Atlas (M0) → Render (server) → Vercel (client)**.

> **The local demo remains the primary plan. Deployment is the backup flex.** A rock-solid
> local run beats a flaky live URL on stage. Only deploy if you have time to spare.

## Do it in this ORDER
**Atlas → Render → Vercel → set `CLIENT_URL` on Render to the final Vercel URL → redeploy Render.**
(You need the Render URL before configuring Vercel, and the Vercel URL before finalizing Render's CORS — hence the loop back at the end.)

---

## (a) MongoDB Atlas — the database
1. Create a free account at https://www.mongodb.com/atlas and create a **free M0 cluster**.
2. **Database Access** → Add a database user (username + password). Save the password.
3. **Network Access** → Add IP Address → **Allow access from anywhere** (`0.0.0.0/0`).
   (Render's egress IPs aren't static on the free tier, so allow-all is the pragmatic choice.)
4. **Connect → Drivers** → copy the connection string, e.g.
   `mongodb+srv://<user>:<password>@cluster0.xxxx.mongodb.net/ledgerwatch?retryWrites=true&w=majority`
   — insert your password and add the DB name `ledgerwatch` before the `?`. This is your `MONGO_URI`.

## (b) Render — the server (Express API)
1. Push this repo to GitHub. At https://render.com → **New → Web Service** → connect the repo.
2. Settings:
   - **Root Directory:** `server`
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
3. **Environment variables** (Render injects `PORT` automatically — do not set it):
   | Key | Value |
   |---|---|
   | `MONGO_URI` | the Atlas connection string from (a) |
   | `JWT_SECRET` | a long random string (also signs push action tokens) |
   | `ANTHROPIC_API_KEY` | *(optional — omit to run on template/parser fallbacks)* |
   | `CLIENT_URL` | the Vercel URL from (c) — set after (c), see the loop-back |
   | `AUTOMATION_INTERVAL_MS` | `60000` |
   | `NODE_ENV` | `production` |

   **Optional integrations** — every one of these degrades gracefully if you leave it
   unset, so you can deploy without any of them and add them later:
   | Key | Value | If omitted |
   |---|---|---|
   | `TWILIO_ACCOUNT_SID` | `AC…` from console.twilio.com | WhatsApp sends are skipped; the manual wa.me link still works |
   | `TWILIO_AUTH_TOKEN` | Twilio auth token | ↑ |
   | `TWILIO_WHATSAPP_FROM` | `whatsapp:+14155238886` (sandbox) | ↑ |
   | `SMTP_HOST` | `smtp.gmail.com` | Email sends are skipped and logged |
   | `SMTP_PORT` | `587` | ↑ |
   | `SMTP_USER` | `you@gmail.com` | ↑ |
   | `SMTP_PASS` | **Gmail App Password**, not your login password | ↑ |
   | `MAIL_FROM` | `LedgerWatch <you@gmail.com>` | ↑ |
   | `VAPID_PUBLIC_KEY` | from `npx web-push generate-vapid-keys` | Push disabled; in-app toasts remain |
   | `VAPID_PRIVATE_KEY` | ↑ same command | ↑ |
   | `VAPID_SUBJECT` | `mailto:you@example.com` | ↑ |
   | `ALCHEMY_API_KEY` | Alchemy key (stays server-side, proxied) | Wallet falls back to public testnet RPC |
   | `ENABLE_MAINNET` | **leave `false`** | Only testnet chains are selectable (the intended state) |

   > **Web Push needs HTTPS.** Vercel and Render both serve HTTPS, so push works in this
   > deployment; it will *not* work over a plain-http LAN IP. On iOS, Web Push is only
   > delivered to a PWA that has been **added to the home screen** (iOS 16.4+).
   >
   > **Keep `ENABLE_MAINNET=false`.** Setting it to `true` exposes real-money chains in the
   > wallet and must not be done without a security audit first.
4. Deploy. Note the service URL, e.g. `https://ledgerwatch-api.onrender.com`. This is your `VITE_API_URL`.
5. Sanity check: open `https://<render-url>/api/health` → `{"status":"ok"}` (may take ~30–60s on a cold start).

## (c) Vercel — the client (Vite React app)
1. At https://vercel.com → **Add New → Project** → import the same repo.
2. Settings:
   - **Root Directory:** `client`
   - **Framework Preset:** Vite (auto-detected; Build `npm run build`, Output `dist`)
3. **Environment variable:**
   | Key | Value |
   |---|---|
   | `VITE_API_URL` | the Render URL from (b), e.g. `https://ledgerwatch-api.onrender.com` |
4. Deploy. Note the Vercel URL, e.g. `https://ledgerwatch.vercel.app`.

## (d) Close the loop — CORS
1. Back on **Render → your service → Environment**, set **`CLIENT_URL`** to the Vercel URL
   from (c) (e.g. `https://ledgerwatch.vercel.app`). You can list several comma-separated.
2. **Redeploy** the Render service (or "Clear cache & deploy") so the new `CLIENT_URL` takes effect.

## (e) Render free-tier COLD STARTS — important for the demo
The free instance **sleeps after ~15 min of inactivity**; the first request then takes
**~30–60 seconds** to wake. Before presenting:
- **Warm it a few minutes ahead:** open `https://<render-url>/api/health` (or load the app)
  and wait until it responds fast. Hit it again right before you go on.
- Optionally keep a browser tab polling `/api/health` during setup.

## (f) Seed the deployed database (once)
Run the seed locally but pointed at Atlas, so the live demo has data:
```bat
cd server
set MONGO_URI=mongodb+srv://<user>:<password>@cluster0.xxxx.mongodb.net/ledgerwatch?retryWrites=true^&w=majority
npm run seed
```
(PowerShell: `$env:MONGO_URI="...."; npm run seed`. Note `^&` escapes `&` in cmd; in
PowerShell just quote the whole string.) Re-running is safe — the seed is idempotent and
only touches the demo user. Then log in at the Vercel URL with `demo@ledgerwatch.app` / `demo1234`.

---

### Final reminder
Local first. If the live URL is cold, flaky, or the Atlas/Render/Vercel wiring fights you
five minutes before you present — **run the local demo** (`DEMO_SCRIPT.md`) and mention the
deployment exists as proof it ships. That is the safe play.
