# LEDGERWATCH — PITCH SCRIPT & JUDGE Q&A

### Career Quest — rehearsal document

> Read this out loud at least twice before demo day. The words in **bold** are the
> lines that matter most — if you remember nothing else, remember those.

---

# PART 1 — THE 30-SECOND PITCH

_(Use this when someone walks up to your table and asks "so what is this?")_

> "LedgerWatch is an automation platform with two agents inside it.
>
> The first one solves a problem every Nigerian business owner has — people who buy
> on credit and don't pay back. It tracks every debtor, and when payment is due it
> automatically writes the reminder, including your bank account details, and sends
> it on WhatsApp. When they pay, you mark it paid, and it stops chasing them.
>
> The second one is a market agent. It watches crypto assets across multiple
> blockchains, and when a condition you set is hit, it alerts you, explains what
> happened, and suggests a trade — which you approve or reject.
>
> **Both of them run on the same automation engine. And both of them are built so a
> human always makes the final decision.**"

**Then stop talking.** Let them ask the next question. Don't over-explain.

---

# PART 2 — THE FULL PITCH (2–3 minutes)

_(Use this for the formal presentation. Four movements: Problem → Solution → How →
Why it matters.)_

### MOVEMENT 1 — THE PROBLEM (spend real time here)

> "Let me start with a problem that costs Nigerian businesses money every single day,
> and almost nobody has solved properly.
>
> If you walk into any market in Lagos — Balogun, Alaba, Computer Village — and you
> ask a trader how they track customers who bought on credit, they will show you a
> notebook. A physical notebook. Names, amounts, sometimes a date, sometimes not.
>
> That notebook has three failures built into it. **It doesn't remind you.** It
> doesn't know that Musa's payment was due four days ago. **It doesn't chase.** You
> have to remember, and then you have to find the courage to ask — and asking a
> customer for money is uncomfortable, so people delay it, and delay becomes never.
> **And it doesn't remember.** When that notebook fills up or gets lost, the entire
> credit history of the business disappears.
>
> So money that was already earned just... evaporates. Not because the customer
> refused. Because nobody followed up properly.
>
> Now hold that thought, because there's a second version of the exact same problem.
> A trader watching crypto markets cannot watch twenty-four hours a day. They sleep.
> They go to work. And the move they were waiting for happens while they're not
> looking. **Same failure — a human being cannot monitor something continuously.**"

_(Pause here. This is the moment the room realises the two modules are one idea.)_

### MOVEMENT 2 — THE SOLUTION

> "LedgerWatch solves both, because underneath they are the same problem: **something
> needs to be watched continuously, a condition needs to be detected, and a human
> needs to be told at exactly the right moment.**
>
> So I built one automation engine, and put two agents on top of it.
>
> **Receivables** watches your debtors. **Market Watch** watches the markets. Same
> engine, same pattern, two completely different problems solved."

### MOVEMENT 3 — HOW IT ACTUALLY WORKS

> "On the Receivables side: you record who owes you, how much, and when it's due. The
> automation engine runs in the background and checks continuously. When a debt
> becomes due, the system writes the reminder itself — it knows the amount, it knows
> how many days overdue, and it embeds **your** bank account details directly in the
> message so the customer knows exactly where to send the money.
>
> It also adjusts its tone. A first-time reminder is gentle. Someone who has been
> reminded repeatedly gets a firmer message. Then it opens WhatsApp with the message
> already written and the customer's number already loaded.
>
> When they pay, you mark it paid — and every future reminder for that person is
> automatically cancelled. **The chasing stops the moment the money arrives.**
>
> On the Market Watch side: you tell the agent what to watch, in plain English —
> 'watch Bitcoin, alert me if it drops half a percent.' The engine monitors prices
> across multiple blockchain assets. When your condition is hit, it raises an alert,
> explains in plain language what happened, and suggests buy or sell.
>
> **And then it stops and waits for you.** You approve, and the trade executes
> against a simulated portfolio. You reject, and nothing happens."

### MOVEMENT 4 — WHY IT MATTERS (the close)

> "Three things I want to leave you with.
>
> **First — it never spends your money on its own.** Not on the debt side, not on the
> trading side. The agent prepares, explains, and recommends. A human approves. That
> was a deliberate engineering decision, not a missing feature. An agent that
> auto-executes financial transactions is a liability, not an innovation.
>
> **Second — it degrades gracefully.** The AI writes better reminders and answers
> questions in natural language. But if the AI is unavailable, the system falls back
> to templates and rule-based parsing and keeps running. I tested this — seventeen
> out of seventeen fallback tests pass with the AI completely switched off. **The
> product works without the AI. The AI just makes it better.**
>
> **Third — it was built for here.** Naira. Nigerian bank details inside the message.
> Nigerian phone numbers, normalised automatically for WhatsApp. WhatsApp as the
> channel, because that is what people here actually use. This is not a foreign
> template with a Nigerian label on it."

---

# PART 3 — DEMO NARRATION

_(What to actually SAY while you click. Roughly 4 minutes. Practise until smooth.)_

### BEFORE YOU START (do this off-stage)

- Mongo running, server running, client running
- `npm run seed` freshly run
- `AUTOMATION_INTERVAL_MS=300000` so the loop doesn't fire during setup
- Already logged in as `demo@ledgerwatch.app`
- Browser zoom at ~110% so the back row can read it

### THE RECEIVABLES STORY (~2 min)

**[Dashboard is open]**

> "This is a business owner's dashboard. These numbers at the top are real —
> total outstanding, how many are overdue, what's been collected."

**[Point at the debts table]**

> "These are customers who bought on credit. You can see who's pending, and these two
> in red are already overdue — the money was due, it hasn't come."

**[Click Check Now / run automation]**

> "Now — I haven't touched these two debts. Watch what the automation does on its own."

**[Reminders appear]**

> "It found both overdue accounts, and it wrote the reminders itself."

**[Open one reminder]**

> "Look at the message. It has the customer's name, the amount, how many days late —
> **and my bank account details, right there in the message.** The customer doesn't
> have to ask where to pay."

**[Click Send on WhatsApp]**

> "One click. WhatsApp opens, the number is loaded, the message is written. The owner
> just presses send."

**[Go back, click Mark as Paid]**

> "Customer pays. Owner marks it paid."

**[Show reminders cancelled]**

> "**And every future reminder for that customer is cancelled automatically.** No
> awkward message going out to someone who already paid."

**[Type in the Ask box: "who owes me the most?"]**

> "And you can just ask it questions about your own money."

### THE MARKET WATCH STORY (~2 min)

**[Switch tab]**

> "Second agent. Same engine, different problem."

**[Type in chat: `watch BTC drop 0.5%`]**

> "I tell it what to watch in plain English."

**[Show it created the watch]**

> "It understood, created the watch, and recorded a baseline price to measure against."

**[Click Check Now]**

> "Now let the engine check the live market."

**[Alert appears]**

> "There it is. It detected the condition, and notice — **it explains why.** Not just
> a number. It tells you what moved and what it suggests."

**[Point at Approve / Dismiss]**

> "And this is the most important part of the whole project. **It stops here.** It
> will not trade. It waits for a human."

**[Click Approve, show portfolio update]**

> "I approve — and now the portfolio updates. Cash down, holding added, profit and
> loss recalculated live. This is a simulated portfolio — **no real money is ever at
> risk, by design.**"

**[Type: "how is my portfolio?"]**

> "And again, I can just ask it."

### THE CLOSING LINE (memorise this word for word)

> "So — two agents, one automation engine. One chases money you're already owed. One
> watches markets you can't watch yourself.
>
> **Both of them are fully automated in intelligence, and deliberately manual in
> execution. They are one API key away from being completely hands-free — and I built
> them human-in-the-loop on purpose, because when software touches money, the last
> decision should belong to a person.**"

_(Then stop. Silence is confident. Let them ask questions.)_

---

# PART 4 — JUDGE Q&A SHEET

_(The hard questions, and tight answers. Read these until they're automatic.)_

## On Receivables

**Q: What if the debtor blocks the number?**

> "Then that message doesn't land — but the debt doesn't disappear. The record, the
> amount, the due date and the full reminder history stay in the system. And because
> the message comes from the owner's own WhatsApp, blocking them means ending the
> business relationship entirely — most customers won't do that. If they do, the
> owner can see reminders were generated and never answered, and escalates offline."

**Q: What if the debtor changes their number?**

> "The owner edits the phone number in one click — editing is built in. And the
> system surfaces the pattern: reminders generated, no response, no payment. That
> pattern is the signal to escalate. The system's job is to make sure nothing gets
> silently forgotten."

**Q: What if they just ignore it completely?**

> "Then no software on earth can force them. I'll be direct about that. **What
> LedgerWatch removes is the owner's excuse** — the forgetting, the discomfort of
> asking, the 'I'll chase them next week' that becomes never. It turns collection
> from an emotional confrontation into a calm, scheduled, professional process. And
> every interaction builds a payment history — which is the foundation of the next
> phase."

**Q: Why doesn't it send automatically? Why must the owner tap?**

> "Two reasons. First, automated bulk messaging from a business number risks the
> account being flagged or banned by WhatsApp. Second, it's a design principle —
> messages that go out under a business's name should have a human behind them. It's
> one WhatsApp Business API key away from fully hands-free. I chose not to."

**Q: What stops someone lying that they paid?**

> "Today it's owner-confirmed — the owner marks it paid. The next phase integrates
> payment gateways like Paystack or Flutterwave, so the system confirms payment via
> webhook. Then 'paid' is verified, not claimed."

**Q: You're storing people's debt information. What about privacy?**

> "Taken seriously. Every record is scoped to the owner who created it — no user can
> ever see another user's data. Passwords are hashed, sessions expire. Full NDPR
> compliance is a requirement before commercial launch, not an afterthought."

**Q: Kippa and Bumpa already do this. Why you?**

> "They're strong products, and their existence proves the market is real. My focus
> is narrower and deeper: **the chasing, not the bookkeeping.** Most tools help you
> record the debt. LedgerWatch is built around the follow-up — the tone escalation,
> the cadence, the automatic cancellation, the bank details inside the message. And
> it's one half of a broader automation platform, not a standalone ledger."

## On Market Watch

**Q: Can it predict the market?**

> "No. And anyone who tells you their bot can is selling something. It doesn't
> predict — it monitors conditions you define and surfaces them the instant they
> happen. **The value is in never missing a move, not in fortune-telling.**"

**Q: It's simulated. Isn't that a fake product?**

> "It's a deliberate boundary. I built the complete decision pipeline — monitoring,
> detection, explanation, recommendation, approval, portfolio accounting — and I
> stopped at execution. Auto-trading real funds raises regulatory questions under
> Nigerian SEC rules and creates real risk for users. **That's an engineering
> judgment, not a missing feature.** The execution layer is an exchange API key away."

**Q: What if the price API goes down?**

> "It's cached with a fallback. If the feed fails or rate-limits, the system serves
> the last known prices and keeps running. The automation loop is wrapped so one
> failure can never crash the engine."

**Q: The suggestions are just rules, not real AI.**

> "Correct, and that's intentional. The user can see exactly why every alert fired.
> **A black-box AI trade signal you cannot audit is worse than a transparent rule you
> can.** The AI handles language and explanation — where it genuinely adds value —
> not opaque financial decisions."

## On the project overall

**Q: What's the most technically impressive part?**

> "That both modules share one automation engine. Watching a payment due-date and
> watching a market condition are the same computational pattern — monitor, detect,
> notify, wait for approval. Recognising that meant a third module costs a fraction
> of the first two."

**Q: What was the hardest part?**

> "Making it fail gracefully. It's easy to build something that works when everything
> is available. I built it so the app fully works with the AI switched off entirely —
> template reminders, rule-based command parsing, computed answers. Seventeen out of
> seventeen fallback tests pass with no AI key. **Most AI products die when the API
> key dies. This one doesn't.**"

**Q: How do you make money?**

> "Subscription for business owners — a monthly fee well below the value of a single
> recovered debt. Then a tiered plan for higher volume. And longer term, the payment
> history the platform accumulates becomes genuinely valuable: **a business's record
> of who actually pays is the raw material for credit scoring**, which opens lending
> partnerships."

**Q: Who is this for?**

> "Anyone owed money on informal terms — market traders, shop owners, fashion
> designers, event planners, suppliers, freelancers. And on the market side, anyone
> holding crypto who can't monitor it continuously. The overlap is real: a lot of
> young Nigerian business owners are both."

---

# PART 5 — WHAT'S NEXT (the roadmap answer)

_(Judges always ask this. Having specific answers signals you think like a founder.)_

### Immediate next (weeks)

1. **Verified payment confirmation** — Paystack/Flutterwave webhooks so 'paid' is
   confirmed by the gateway, not claimed by the owner.
2. **Fully automated WhatsApp delivery** — WhatsApp Business API so reminders send
   hands-free, with the human-approval option retained as a setting.
3. **True on-chain reading** — today the agent monitors assets across multiple
   blockchains at the market layer. Next it reads the chain directly: wallet
   balances, transaction activity, and contract events through node infrastructure.
   **The agent stops watching the market on top of the chain and starts watching the
   chain itself.**

### Medium term (months)

4. **Debtor payment reputation** — every debt cycle builds a score. A business can see
   at a glance who reliably pays before extending credit again.
5. **Multi-user businesses** — staff accounts with permissions, so a shop with several
   attendants shares one ledger.
6. **Offline-tolerant mobile experience** — because network in Nigerian markets is not
   guaranteed.

### The bigger vision

> "The engine is the product. Receivables and Market Watch are the first two agents
> on it. The same monitor-detect-notify-approve pattern applies to inventory running
> low, invoices going unpaid, subscriptions lapsing, contracts expiring. **LedgerWatch
> is a platform for putting a reliable watcher on anything a business owner cannot
> watch themselves.**"

---

# PART 6 — DELIVERY NOTES

**Do:**

- Speak slower than feels natural. Nerves speed you up.
- Pause after your strongest lines — let them land.
- Say "I built" and "I decided," not "it does." Own the engineering.
- If something breaks, stay calm: "Let me show you another part while that reloads."
- Admit limits confidently. **Naming your own weakness before a judge does is power.**

**Don't:**

- Don't claim it predicts markets.
- Don't claim on-chain reading you haven't built.
- Don't say "just" or "only" about your own work.
- Don't fill silence after a question — answer, then stop.

**If you forget everything, remember these three lines:**

1. "One automation engine, two agents — one chases money you're owed, one watches
   markets you can't watch."
2. "It works completely without the AI. The AI just makes it better."
3. "Fully automated in intelligence, deliberately manual in execution — because when
   software touches money, the last decision should belong to a person."
