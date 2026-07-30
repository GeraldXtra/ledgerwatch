# LEDGERWATCH · FINAL PRESENTATION

### Eberechukwu Uchechukwu Gerald · ADSE AI/ML, Semester One · Aptech

> Read this out loud twice before you present. Standing up, with a timer.
> Sections marked **[ONLY IF WORKING]** must be tested tomorrow morning before you
> decide to include them. If a section is not working, skip it cleanly. Nobody knows
> what you planned to say.

---

## TIMING

|     | Section             | Time | Running |
| --- | ------------------- | ---- | ------- |
| 1   | Who I am and Aptech | 50s  | 0:50    |
| 2   | The problem         | 30s  | 1:20    |
| 3   | Receivables         | 80s  | 2:40    |
| 4   | Paying in crypto    | 50s  | 3:30    |
| 5   | Market Watch        | 50s  | 4:20    |
| 6   | The wallet          | 30s  | 4:50    |
| 7   | Close               | 20s  | 5:10    |

**If your slot is four minutes**, cut section 4 or section 6 and keep the rest.

---

## BEFORE YOU WALK UP

- [ ] MongoDB running, server running, client running
- [ ] Already signed in, sitting on Receivables
- [ ] Browser zoom about 110 percent so the back of the room can read it
- [ ] Wallet funded from the faucet so it does not show zero
- [ ] Every section you plan to demo tested once, this morning
- [ ] Notifications silenced, other tabs closed
- [ ] Water. Two slow breaths.

---

# 1 · WHO I AM _(50 seconds)_

_Stand still. Do not touch the laptop yet. Look at the room._

> "Good morning everyone.
>
> My name is **Eberechukwu Uchechukwu Gerald**. I am an **ADSE AI and Machine
> Learning** student here at Aptech, Semester One.

_Small pause._

> Before Aptech, I had curiosity and nothing to do with it. I wanted to understand how
> the products I used every day were actually made, but curiosity on its own does not
> build anything.
>
> Aptech gave that curiosity somewhere to go. C programming, the web, React, Node,
> databases. What I have now is not just an understanding of how software works, but
> the ability to sit down and build a complete system, front to back.

_Slow down. This is your line._

> **I came here with curiosity. I am leaving with capability.**

_Pause. Two full seconds. Then move to the laptop._

---

# 2 · THE PROBLEM _(30 seconds)_

_Tell this like a story, not a recital._

> "So what did I build, and why?
>
> Every company that sells on credit has the same quiet problem. The work is done, the
> invoice is issued, and then somebody has to remember to follow it up. Somebody has to
> notice that a payment was due four days ago. Somebody has to find the time, and the
> courage, to ask a client for money.
>
> And because that is uncomfortable, it gets delayed. And delay becomes never.
>
> **So money that was already earned simply sits there. Not because the client refused
> to pay. Because nobody followed it up.**
>
> Now think about the scale. In a large company that is not forty thousand naira. That
> is hundreds of millions sitting in a spreadsheet that nobody is chasing.
>
> That is what I built LedgerWatch to solve."

---

# 3 · RECEIVABLES _(80 seconds)_

_This is your spine. Go slower than feels natural._

**[Receivables Overview on screen]**

> "This is a company's receivables dashboard. Three hundred and twenty six million naira
> outstanding across seven active clients. Collection rate, average days to payment,
> and how overdue the unpaid balances are."

**[Point at the aging chart]**

> "This chart matters more than it looks. It shows how old the money is. The longer a
> balance sits in those later buckets, the less likely it is to ever come in."

**[Switch to Debts tab]**

> "Here is the ledger itself. Real companies, real invoices, partial payments tracked
> against each one. You can see exactly what was invoiced and what is still open."

**[Open a debtor and generate a reminder]**

> "Now watch what the agent does. I have not written anything."

**[Reminder appears]**

> "It wrote the reminder itself. The client's name. The exact outstanding balance. It
> even acknowledges the part payment they already made. **And my bank details are right
> there inside the message**, so the client does not have to ask where to send it.
>
> WhatsApp. Email. Or both."

**[Mark as paid, show reminders cancel]**

> "The client pays, I mark it paid, and **every future reminder for that client is
> cancelled automatically.** No embarrassing message going out to somebody who has
> already paid you."

**[If time allows, show Debtors tab]**

> "And over time the system learns who actually pays on time and who does not. That
> becomes a payment reliability rating you can check before extending credit again."

---

# 4 · PAYING IN CRYPTO **[ONLY IF WORKING]** _(50 seconds)_

_Test this before you decide to include it. If the settlement does not run, either skip
the section entirely, or show only the address in the reminder and describe the rest._

> "Now here is the part I am most proud of.
>
> Bank transfers are slow, and they are painful across borders. So a client can also
> pay in crypto. But the interesting problem is not accepting crypto. It is knowing
> **who** paid you.
>
> So the system generates a **unique blockchain address for that single invoice.** It
> is derived from the company's own wallet, on a separate branch that no ordinary
> wallet software ever touches, so those funds stay isolated.
>
> That address goes into the reminder, with the exact amount, the network, and a very
> clear warning about what to send and what not to send.
>
> Then the agent watches that address. And because that address belongs to one invoice
> and one invoice only, **money arriving there is proof of who paid.** No reference
> number. No matching by hand.
>
> It waits for the network to confirm the payment properly, converts it at the rate
> that was quoted, and settles the invoice. If it is a partial payment, it records the
> part and keeps waiting for the rest."

---

# 5 · MARKET WATCH _(50 seconds)_

**[Switch to Market Watch]**

> "The second agent solves the same shape of problem in a different place. Somebody
> holding crypto cannot watch the market for twenty four hours a day. They sleep. They
> work. And the move they were waiting for happens while they are not looking.
>
> So they tell the agent what to watch, and it watches. Live prices, real conditions."

**[Point at an alert]**

> "When a condition is hit, the agent raises an alert **and explains why.** Not just a
> number on a screen. It tells you what moved and what it thinks you should do."

**[Point at Buy, Sell, Dismiss]**

> "And this is the most important design decision in the entire project. **It stops
> here.** Three choices. Buy, Sell, or Dismiss. The agent recommends. I decide the side
> and I decide the amount. Nothing executes until I confirm."

**[Scroll to alert history, point at an OVERRODE row]**

> "And it keeps a record of what the agent suggested against what I actually did. You
> can see here where the agent said buy and I chose to sell instead. **The agent
> advises. The human decides. And the system remembers both.**"

---

# 6 · THE WALLET _(30 seconds)_

**[Switch to Wallet]**

> "All of that sits on a real working wallet. Several blockchains. Send, receive, and a
> full transaction history that you can verify on a public block explorer.
>
> **The private key is encrypted on the user's own device. It never touches my server.**
> Not once. When you sign a transaction, you enter your password and it is signed in
> your browser.
>
> It runs on test networks, and that is a deliberate choice. Everything is real. Real
> cryptography, real transactions, real confirmations. What is not real is the money.
> **Putting unaudited key handling in front of the public would be irresponsible, so I
> did not do it.** Moving to live networks is a configuration change, not a rewrite."

---

# 7 · THE CLOSE _(20 seconds)_

_Step back. Face the room. Slow right down._

> "So. Two agents on one automation engine. One chases the money you are already owed.
> One watches the markets you cannot watch yourself. And a wallet underneath that lets
> both of them touch real value safely.
>
> **Everything is fully automated in its intelligence, and deliberately manual in its
> execution.**
>
> **Because when software touches money, the last decision should belong to a person.**
>
> Thank you."

_Then stop talking. Silence is confident._

---

# IF SOMETHING BREAKS

Stay calm and keep speaking. Nobody remembers a slow page. Everybody remembers panic.

- **A page will not load** → "Let me show you this while that comes back." Move on.
- **Prices are not updating** → "The market feed is rate limited right now, so it is
  serving cached prices, which is exactly the fallback I built for it." _(This is true,
  and it sounds excellent.)_
- **A section fails completely** → skip it. It was never promised.
- **Everything dies** → "The system is misbehaving. Let me walk you through what it
  does." Then narrate from memory. You know this cold.

---

# LIKELY QUESTIONS

**"What if the client ignores the reminder or blocks the number?"**

> "Then that message does not land, but the debt does not disappear. The record, the
> amount, and the full history stay in the system. What LedgerWatch removes is the
> excuse. The forgetting, the awkwardness, the intention to chase it next week that
> becomes never."

**"Why not send the WhatsApp message fully automatically?"**

> "Two reasons. Automated bulk messaging from a business number risks the account being
> flagged. And messages that go out under a company's name should have a person behind
> them. It is one integration away from being fully hands free. I chose not to."

**"Can the market agent predict prices?"**

> "No. And anybody who tells you their bot can is selling something. It does not
> predict. It monitors the conditions you set and surfaces them the instant they
> happen. The value is in never missing a move, not in fortune telling."

**"Why test networks and not real money?"**

> "Because I built the complete decision pipeline and stopped deliberately at
> execution. Shipping key custody that has not been audited would put real people's
> funds at risk. That is an engineering judgement, not a missing feature."

**"What was the hardest part?"**

> "Making it fail gracefully. The whole application works with the AI switched off
> completely. Template reminders, rule based parsing, calculated answers. Most AI
> products die when the API key dies. This one does not."

**"How would this make money?"**

> "A monthly subscription that costs far less than a single recovered invoice. And
> over time the payment history it builds becomes genuinely valuable, because a record
> of who actually pays is the raw material for credit scoring."

**"What is next?"**

> "Connecting the wallet directly to the market agent so an approved alert executes as
> a real transaction on the blockchain. The foundation for it is already built. That is
> the next piece of work."

---

# DELIVERY

**Do**

- Speak slower than feels natural. Nerves speed you up by about a third.
- Pause after your strong lines instead of rushing past them.
- Look at people during the introduction and the close. Look at the screen only during
  the demo.
- Say "I built", "I decided", "I chose". Own it.

**Do not**

- Do not apologise. Never say it is just a small project or that you only had a few days.
- Do not claim anything you have not tested this morning.
- Do not read this sheet on stage. Know the shape and speak it naturally.
- Do not fill the silence after a question. Answer, then stop.

---

## THE THREE LINES THAT CARRY EVERYTHING

1. **"I came here with curiosity. I am leaving with capability."**
2. **"Money that was already earned simply sits there, because nobody followed it up."**
3. **"When software touches money, the last decision should belong to a person."**
