/**
 * THE USER GUIDE, AS DATA.
 *
 * Every page is an object: a slug (its address under /docs), a title, the
 * group it sits in, one line of introduction, and a list of blocks that
 * docs/Blocks.jsx renders. Inline text may use **bold**, `code` and
 * [a link](/path). Pictures live in client/public/docs and are referenced by
 * file name only.
 *
 * The order of this array is the order of the sidebar and of the previous
 * and next links. Keep the first page the introduction.
 */

const h2 = (text) => ({ type: "h2", text });
const h3 = (text) => ({ type: "h3", text });
const p = (text) => ({ type: "p", text });
const ul = (items) => ({ type: "ul", items });
const ol = (items) => ({ type: "ol", items, steps: true });
const note = (text, tone, title) => ({ type: "callout", text, tone, title });
const img = (src, caption, phone = false) => ({ type: "img", src, caption, phone });
const table = (head, rows) => ({ type: "table", head, rows });

export const GROUPS = [
  { id: "start", label: "Start here" },
  { id: "receivables", label: "Receivables" },
  { id: "market", label: "Market Watch" },
  { id: "wallet", label: "Wallet" },
  { id: "settings", label: "Settings" },
  { id: "help", label: "Help" },
];

export const GUIDE = [
  // ---------------------------------------------------------------- START --
  {
    slug: "introduction",
    group: "start",
    title: "What LedgerWatch is",
    intro:
      "LedgerWatch keeps track of the money people owe you, chases it for you, closes the invoice when it arrives, and watches coin prices so you do not have to. This guide explains every page and every feature.",
    blocks: [
      img("landing.webp", "The front page at useledgerwatch.co."),
      h2("Who it is for"),
      p(
        "It was built for a small business that sells on credit: a distributor, a contractor, a supplier, anyone who does the work first and gets paid later. Amounts are in naira, reminders can go out over WhatsApp, and a customer can pay by bank transfer or, if you choose to offer it, in a dollar stablecoin on the blockchain."
      ),
      h2("The four sections"),
      p("Everything in LedgerWatch lives in one of four sections, always one click away in the bar across the top of the screen."),
      table(
        ["Section", "What it does"],
        [
          ["**Receivables**", "Records what you are owed, takes payments, writes and sends reminders, and shows you which customers pay on time. See [Receivables](/docs/receivables)."],
          ["**Market Watch**", "Watches coin prices against conditions you set and raises an alert when one is met. You decide whether to buy, sell or ignore it, on paper or with real funds. See [Market Watch](/docs/market-watch)."],
          ["**Wallet**", "A wallet for Ethereum, Base, Arbitrum, Optimism, Polygon, BNB Chain, Avalanche and Bitcoin, created and kept in your browser. See [The wallet](/docs/wallet)."],
          ["**Settings**", "Your profile, the bank details that go into reminders, crypto payment options, security, wallet backup, notifications, and the danger zone. See [Settings](/docs/settings)."],
        ]
      ),
      h2("How it keeps your money yours"),
      p(
        "The wallet keys are generated in your browser, encrypted with a password you choose, and stored on your device. They are never sent to LedgerWatch. Every transaction, whether a transfer, a swap or a sweep of collected payments, asks for that password at the moment of signing and nothing is signed without it."
      ),
      p(
        "That is a deliberate trade. It means nobody can take your funds through LedgerWatch, and it also means nobody can recover them for you if you lose your password and your recovery phrase. The [safety page](/docs/safety) explains what that means in practice."
      ),
      h2("Two kinds of network"),
      p(
        "The wallet and the crypto payment addresses work on **real networks**, where the money is real, and on **test networks**, where the coins are free and worthless and exist for practice. Every screen names the network it is on. The [networks page](/docs/networks) explains the difference and how to get test coins."
      ),
      h2("Reading this guide"),
      p(
        "Each page of the guide describes one part of the product, top to bottom, with a picture of the screen it is describing. If you are new, read [Getting started](/docs/getting-started) first. If something is not working, go straight to [Troubleshooting](/docs/troubleshooting)."
      ),
    ],
  },
  {
    slug: "getting-started",
    group: "start",
    title: "Getting started",
    intro: "Creating an account, signing in, and the first five things worth doing.",
    blocks: [
      h2("Create an account"),
      img("signup.webp", "The create account form."),
      ol([
        "Open [useledgerwatch.co](https://useledgerwatch.co) and press **Get started**, or press **Create an account** on the sign in page.",
        "Enter your full name, your email address and a password of at least six characters. You can also add your bank details here under **Bank details (optional)**; they can be added later in Settings.",
        "Tick the verification box, then press **Create account**.",
        "Check your email for a six digit code. It is valid for thirty minutes. Type it in and press **Confirm and continue**. If it has not arrived, press **Send a new code**; if you typed the wrong address, press **Use a different email**.",
      ]),
      p(
        "You can also press **Sign up with Google**. Google confirms who you are and sends you back signed in, with no password to remember. An account made that way can still set a password later from Settings if you want one."
      ),
      note(
        "The code screen says clearly when a code has expired rather than when it was mistyped, because the two need different fixes: one needs a new code, the other needs a closer look at what you typed.",
        "info"
      ),
      h2("Sign in"),
      img("signin.webp", "The sign in page."),
      p(
        "Enter your email and password, tick the verification box, and press **Sign in**. If you signed up with Google, press **Continue with Google**. A session lasts seven days on that device; changing your password signs every other device out."
      ),
      h3("Forgot your password"),
      p(
        "Press **Forgot your password?** on the sign in page, enter your email, and a six digit code arrives. It is valid for fifteen minutes. Enter the code and a new password of at least eight characters, then sign in with it. Resetting your password does not touch your wallet, which has its own password."
      ),
      h2("A tour of the interface"),
      img("receivables-overview.webp", "The bar across the top holds the four sections. On the right: your account, the guide, the theme switch and sign out."),
      ul([
        "**The top bar.** The four sections sit in the middle. Your name on the right opens Settings. The book icon opens this guide. The moon or sun switches between the light and dark theme, and the last icon signs you out.",
        "**The page.** Every page begins with its name, one line about it, and, where it has figures, a strip of them.",
        "**On a phone** the four sections move to a bar along the bottom of the screen. See [On your phone](/docs/on-your-phone).",
        "**Dialogs.** Recording a debt, viewing an invoice, trading and every wallet action open in a dialog over the page. Press Escape or the cross to close one. Nothing is saved until you press the button that names the action.",
      ]),
      h2("The first five things to do"),
      ol([
        "**Add your payout details** in Settings, so every reminder tells the customer exactly where to pay. See [Settings](/docs/settings#payout-details).",
        "**Record your first debt** on the Receivables page: a name, an amount and a due date. See [Debts](/docs/debts).",
        "**Turn on notifications** in Settings, so a due reminder, a received payment or a price alert reaches your phone or computer. See [Notifications](/docs/settings#notifications).",
        "**Create a wallet** if you want to accept stablecoin payments or trade. Write down the recovery phrase before anything else. See [The wallet](/docs/wallet).",
        "**Add a watch** on the Market Watch page and see what an alert looks like, on paper, before any real money is involved. See [Watches and alerts](/docs/watches-and-alerts).",
      ]),
      h2("Light and dark"),
      p(
        "The theme switch in the top bar changes between a light and a dark interface. The choice is remembered on that device. With no choice made, LedgerWatch follows the system setting."
      ),
      img("theme-dark.webp", "The same page in the dark theme."),
    ],
  },
  {
    slug: "on-your-phone",
    group: "start",
    title: "On your phone",
    intro: "LedgerWatch is the same product on a phone, with the navigation moved to where your thumb is.",
    blocks: [
      img("phone-home.webp", "Receivables on a phone. The four sections are along the bottom.", true),
      h2("Navigation"),
      p(
        "The four sections sit in a bar along the bottom of the screen. Tables become stacked cards, figures sit two to a row, and every text box is sized so the phone does not zoom in when you tap it."
      ),
      h2("Add it to your home screen"),
      p("Installed, LedgerWatch opens full screen like an app, and on iPhone that is also what allows notifications."),
      ul([
        "**iPhone (Safari):** open useledgerwatch.co, tap the share button, then **Add to Home Screen**. Notifications need iOS 16.4 or later and the installed app, not the Safari tab.",
        "**Android (Chrome):** open the site, tap the menu, then **Install app** or **Add to Home screen**.",
      ]),
      h2("Notifications on a phone"),
      p(
        "Open the installed app, go to Settings, Notifications, and press **Enable notifications**. Your phone asks for permission once. After that, a due reminder, a detected payment or a price alert arrives as a notification, and a price alert carries Buy and Sell buttons that open the trade for you to confirm."
      ),
      img("phone-wallet.webp", "The wallet on a phone.", true),
      h2("The wallet on a phone"),
      p(
        "The wallet works the same way on a phone. Keys created on a phone live on that phone, so if you use LedgerWatch on both a phone and a computer, bring the wallet across with its recovery phrase and it is the same wallet in both places. See [Backup and recovery](/docs/backup-and-recovery)."
      ),
      note(
        "A wallet is stored in the browser that created it. If you clear that browser's data, the encrypted keys go with it. Your recovery phrase is what brings the wallet back, so write it down before you put any money in.",
        "warn",
        "Before you rely on a phone wallet"
      ),
    ],
  },

  // ---------------------------------------------------------- RECEIVABLES --
  {
    slug: "receivables",
    group: "receivables",
    title: "The Receivables page",
    intro: "One page for everything you are owed: the figures at the top, three tabs underneath.",
    blocks: [
      img("receivables-overview.webp", "The Receivables page on the Overview tab."),
      h2("The figures"),
      p("The strip under the title states four numbers for the whole ledger. They are calculated from every open invoice, not just the ones on screen."),
      table(
        ["Figure", "What it is"],
        [
          ["**Outstanding**", "The total of every open balance, in naira."],
          ["**Overdue**", "How many accounts are past their due date and still unpaid."],
          ["**Collected**", "Money received so far this month."],
          ["**Rate**", "Your collection rate: how much of everything you have ever invoiced has actually been paid."],
        ]
      ),
      h2("The three tabs"),
      ul([
        "**Overview** shows two charts and lets you ask questions about your ledger in plain words.",
        "**Debts** is the ledger itself: every invoice, with filters, sorting, selection, reminders and export. See [Debts](/docs/debts).",
        "**Debtors** groups the same invoices by customer and scores each customer on how reliably they pay. See [Debtors and reliability](/docs/debtors).",
      ]),
      h2("The Overview tab"),
      h3("Invoiced against collected"),
      p("Six months of money owed set against money that actually arrived, month by month. A gap that keeps widening means your customers are paying later and later."),
      h3("How old the money is"),
      p(
        "The unpaid money sorted by how long it has been waiting: current, 1 to 30 days, 31 to 60, 61 to 90, and over 90. The longer a balance sits in a later bucket, the less likely it is to arrive, so this chart tells you who to chase first. Under it, a line counts how many accounts are past due."
      ),
      h3("Ask about your ledger"),
      p(
        "Type an ordinary question, such as **who owes me the most?** or **who never pays on time?**, and press **Ask**. The answer is worked out from your own figures. It needs the assistant to be switched on for the server; when it is not, you get a plain answer based on your totals instead of a written one."
      ),
    ],
  },
  {
    slug: "debts",
    group: "receivables",
    title: "Recording and managing debts",
    intro: "A debt is one invoice: who owes it, how much, and when it was due.",
    blocks: [
      img("receivables-debts.webp", "The Debts tab: four tiles, the filters, and the ledger."),
      h2("Record a debt"),
      img("debt-record.webp", "The record a debt form."),
      p("Press **Record debt** at the top right of the ledger. The form asks for:"),
      table(
        ["Field", "Notes"],
        [
          ["**Debtor name**", "Required. The customer's name as it should appear in reminders."],
          ["**Phone**", "A Nigerian number such as 08031234567. Needed for WhatsApp reminders. Also how LedgerWatch recognises a returning customer."],
          ["**Email**", "Optional. Adding one switches on email reminders for this debt."],
          ["**Amount**", "In naira. Thousands are grouped as you type, and a large figure is repeated in words under the box so nine digits cannot be misread."],
          ["**Due date**", "Required. Overdue is counted from the day after this."],
          ["**Re-remind every (days)**", "How often a reminder may be generated for this debt while it stays unpaid. Blank uses the default of three days."],
          ["**Note**", "Optional. What the invoice was for. It appears on statements."],
        ]
      ),
      p("Press **Add debt** to save it. Press **Cancel** or Escape to discard it."),
      h3("A returning customer"),
      p(
        "As soon as you type a phone number that matches an existing customer, their payment record appears under the form. A customer marked **Risky** or **Fair** shows a warning with their on time rate and what they already owe. A customer marked **Excellent** or **Good** shows a reassurance. Nothing stops you recording the debt either way; the point is that you decide knowing the history."
      ),
      h2("Statuses"),
      table(
        ["Status", "Meaning"],
        [
          ["**Pending**", "Nothing has been paid and the due date has not passed."],
          ["**Partial**", "Part of the amount has been paid."],
          ["**Overdue**", "The due date has passed and a balance is still owed."],
          ["**Paid**", "The full amount has been received, by any method."],
        ]
      ),
      h2("The ledger"),
      p("Every invoice is a row: the customer with their phone, the original amount, the balance still owed with a small progress bar, the due date and the status."),
      ul([
        "**Search** by name or phone. **Filter** by status, and by a due date range with the two date boxes.",
        "**Sort** by clicking any column heading. Click again to reverse the order.",
        "**Open** an invoice by clicking anywhere on its row. See [Payments and receipts](/docs/payments).",
        "The **USDC** chip beside a customer means that invoice has a live crypto payment address waiting for a payment. See [Crypto payments](/docs/crypto-payments).",
        "The **menu** at the end of each row offers **Record payment**, **Generate reminder**, **Mark fully paid**, **Edit** and **Delete**.",
      ]),
      h3("Selecting many"),
      p(
        "Tick the boxes at the left of the rows, or the box in the heading to select every row shown, and a bar appears at the bottom of the screen with **Remind selected**. The bar counts what is selected and clears with the cross."
      ),
      h3("The buttons above the ledger"),
      ul([
        "**Remind all overdue** generates a reminder for every overdue invoice in one go.",
        "**CSV** downloads the invoices currently shown as a spreadsheet file: debtor, phone, amount, paid, balance, due date and status.",
        "**Record debt** opens the form above.",
      ]),
      h2("Edit a debt"),
      p(
        "Choose **Edit** from the row menu or from the invoice dialog. Everything can be changed except one rule: the amount cannot be set below what has already been paid. If the invoice has a crypto payment address, the amount it asks for is updated to match the new balance."
      ),
      h2("Mark fully paid"),
      p(
        "For a debt that was settled outside LedgerWatch, choose **Mark fully paid**. The remaining balance is recorded as a single payment and the status becomes Paid. Prefer **Record payment** when you know the amount and method, because the record is more useful later."
      ),
      h2("Delete a debt"),
      p("Choose **Delete** and confirm. The invoice, its payments and its reminders are removed together. This cannot be undone."),
      h2("The four tiles"),
      p(
        "Above the ledger, four tiles summarise the invoices **currently shown**: total outstanding, how many are overdue, how much has been collected on them, and how many customers have an open balance. Change a filter and the tiles change with it, unlike the figures at the top of the page, which always cover the whole ledger."
      ),
    ],
  },
  {
    slug: "payments",
    group: "receivables",
    title: "Payments and receipts",
    intro: "Open an invoice to record part payments, see the history, and produce a receipt.",
    blocks: [
      img("debt-detail.webp", "An open invoice: the figures, the payment panel, and the actions."),
      h2("The invoice dialog"),
      p(
        "Click a row in the ledger. The dialog shows the customer, the status, and four figures: the original amount, what has been paid, the balance, and the due date. Under those sit the payment panel and, if one has been issued, the crypto payment address. The actions along the bottom are **Generate reminder**, **Crypto payment**, **Mark fully paid**, **Edit** and **Delete**."
      ),
      h2("Record a payment"),
      img("debt-payment.webp", "Recording a part payment."),
      ol([
        "Press **Record payment**. The amount box is filled in with the outstanding balance; change it for a part payment.",
        "Choose the method: **Transfer**, **Cash** or **Other**. Add a note if you like, such as the reference on the bank transfer.",
        "Press **Record payment**. The balance updates immediately, the progress bar moves, and if the balance reaches zero the invoice becomes Paid.",
      ]),
      p("An amount larger than the balance is refused. To record more than is owed, edit the invoice amount first."),
      h2("The payment history"),
      p(
        "Every payment on the invoice is listed with its amount, method, date and note. The bin icon removes a payment that was recorded by mistake; the balance and status are recalculated. Payments that arrived through a crypto payment address are recorded here too, marked with their method."
      ),
      h2("Receipts"),
      p(
        "After a payment is recorded, the **Latest receipt** appears under the history: your business name, who paid, how much, the method, the date and the balance remaining. **Copy as text** puts a plain version on the clipboard, ready to paste into WhatsApp. **Print** prints it or saves it as a PDF."
      ),
      p(
        "When a crypto payment settles an invoice, a receipt is also emailed to the customer automatically, provided they have an email address on file and email is set up on the server."
      ),
    ],
  },
  {
    slug: "reminders",
    group: "receivables",
    title: "Reminders",
    intro: "LedgerWatch writes the message nobody likes writing, and sends it on your say so, or by itself if you ask it to.",
    blocks: [
      img("debt-reminder.webp", "A generated reminder, the send buttons, and the log underneath."),
      h2("Generate a reminder"),
      p(
        "Choose **Generate reminder** from a row's menu or from the invoice dialog. LedgerWatch writes a message for that invoice and opens it for you to read before anything is sent."
      ),
      h3("What the message contains"),
      ul([
        "A greeting by name, the amount, and whether it is due or how many days past due it is.",
        "If part has been paid, thanks for that payment and the balance that remains.",
        "Your bank details, exactly as saved in Settings under Payout details. Without them the message asks the customer to get in touch for the details.",
        "If the invoice has a live crypto payment address, a block with the network, the address, the exact stablecoin amount and the naira it corresponds to. See [Crypto payments](/docs/crypto-payments).",
        "A warm sign off with your name.",
      ]),
      p(
        "When the assistant is switched on for the server, the paragraphs are written for the specific customer and situation and the message is labelled **AI-drafted**. When it is not, a plain template is used and the message is labelled **Template**. The bank details and the crypto block are never written by the assistant; they are added word for word."
      ),
      h2("Sending it"),
      ul([
        "**Send WhatsApp** sends through the WhatsApp provider set up on the server. It needs a valid phone number on the invoice.",
        "**Send Email** sends through the server's email. It needs an email address on the invoice.",
        "**Send Both** does both.",
        "**Open in WhatsApp** opens WhatsApp on your own phone or computer with the message ready to send from your own number. This always works, with nothing set up on the server, and is how most people send.",
      ]),
      p(
        "The line under the buttons tells you what is missing: payout details not set, phone missing or invalid, no email on file. If a provider is not configured on the server, the send is reported as **skipped** rather than silently lost, and the WhatsApp link remains."
      ),
      note(
        "An address at a reserved domain such as example.com is accepted by mail servers and bounced afterwards, so it would report as sent and never arrive. LedgerWatch warns you before sending to one.",
        "warn"
      ),
      h2("The reminder log"),
      p(
        "Every reminder generated for the invoice is listed with its date and status, and under each one a chip per channel: WhatsApp or Email, and whether it was sent, failed, skipped or queued. Hover a chip to see the provider's reason for a failure."
      ),
      h2("How often reminders go out"),
      p(
        "Each debt has its own **Re-remind every (days)** setting, three days by default. LedgerWatch checks the ledger regularly and, for any unpaid invoice whose last reminder is older than its interval, generates the next one. Generating counts, whether or not it was sent, so a reminder you chose not to send still holds the interval."
      ),
      h2("Automatic sending"),
      p(
        "By default reminders are drafted and wait for you. In Settings, Notifications, **Send reminders automatically** lets LedgerWatch send them itself, over WhatsApp, email or both, as they fall due. WhatsApp needs a provider on the server; **Open in WhatsApp** cannot be automated because it sends from your own phone. See [Settings](/docs/settings#notifications)."
      ),
      h2("Reminding many at once"),
      p(
        "**Remind all overdue** above the ledger generates a reminder for every overdue invoice. Select rows and press **Remind selected** to do it for a chosen set. Each reminder is generated, not sent, unless automatic sending is on."
      ),
      h2("Reminders and crypto payments"),
      p(
        "If crypto payments are switched on and you have a wallet on this device, generating a reminder for an invoice with no payment address first offers to issue one, so the message can carry it. You are asked for your wallet password to do that. Cancel, and the reminder is generated without a payment block and says so."
      ),
    ],
  },
  {
    slug: "debtors",
    group: "receivables",
    title: "Debtors and reliability",
    intro: "The same invoices, grouped by customer, with a score for how reliably each one pays.",
    blocks: [
      img("debtors.webp", "The Debtors tab."),
      h2("The table"),
      p(
        "One row per customer, matched by phone number: the name, the total they currently owe, their reliability, and the date of the last thing that happened on their account. Click a column heading to sort, and click a row to open the customer's profile."
      ),
      h2("The reliability score"),
      p(
        "A score out of 100 built from the customer's history with you: how often they paid on time, how late they were when they were late, and how much of what they owed has been paid. A new customer with no completed invoice shows **New** rather than a number that would mean nothing yet."
      ),
      table(
        ["Band", "What it means"],
        [
          ["**Excellent**", "Pays on time, nearly every time."],
          ["**Good**", "Pays, usually on time."],
          ["**Fair**", "Pays, but often late. Worth a shorter reminder interval."],
          ["**Risky**", "A history of very late or missing payments. LedgerWatch warns you when you record a new debt for them."],
          ["**New**", "Not enough history to say."],
        ]
      ),
      h2("The customer profile"),
      img("debtor-profile.webp", "A customer's profile."),
      ul([
        "**Borrowed in total**, **Outstanding**, **On time rate** and **Avg days to pay**, across every invoice they have had with you.",
        "**Payment behaviour**, a chart of money collected from them over time. It needs at least two payments to draw.",
        "**Timeline**, every event in order: each debt recorded, each payment with its method, and each reminder with its status.",
      ]),
      h2("Statements"),
      img("debtor-statement.webp", "A customer statement."),
      p(
        "Press **Statement** on the profile for a printable account of every invoice and every payment for that customer, with the balance under each. **Print** prints it or saves it as a PDF to send. **CSV** downloads the same rows as a spreadsheet. Your company name from Settings appears at the top."
      ),
    ],
  },
  {
    slug: "crypto-payments",
    group: "receivables",
    title: "Crypto payments on invoices",
    intro: "Give an invoice its own blockchain address. When the stablecoin arrives and confirms, the invoice is settled by itself.",
    blocks: [
      h2("How it works"),
      p(
        "Each invoice gets an address of its own, derived from your wallet, so anything that arrives at it is matched to that invoice with no reference number to get wrong. The customer sends the exact stablecoin amount they were quoted. LedgerWatch watches the network, waits for enough confirmations, records the payment, marks the invoice paid and sends the customer a receipt. You then sweep the money into your main wallet whenever you like."
      ),
      p(
        "The stablecoin is **USDC**, or USDT where a network carries it. On test networks only USDC exists. The address only ever holds what was sent to it; LedgerWatch never holds your money."
      ),
      h2("What you need"),
      ul([
        "A wallet on this device, created or imported with its recovery phrase. A wallet imported from a private key alone cannot derive addresses. See [The wallet](/docs/wallet).",
        "**Offer crypto payment on invoices** switched on in Settings, which it is by default.",
      ]),
      h2("Issue an address"),
      img("crypto-issue.webp", "Issuing a payment address for an invoice."),
      ol([
        "Open the invoice and press **Crypto payment**.",
        "Choose the **Network**. Your default from Settings is chosen for you. The quote updates for the network: the invoice balance, the exact stablecoin amount to request, the naira rate used and its age, the token accepted, and how long the address accepts payment.",
        "Enter your **wallet password** and press **Create payment address**. The password unlocks the wallet in your browser to derive the address; only the public address is saved.",
      ]),
      h3("The quote and the rate"),
      p(
        "The stablecoin amount is rounded up to the cent, so a customer who sends exactly that figure always clears the invoice. The naira rate is locked at the moment you create the address. If the naira moves later, the invoice still settles at the rate the customer was quoted, so a customer who pays what they were asked can never be left owing a few naira. The invoice panel shows both the locked rate and today's rate so you can see the drift."
      ),
      h3("Expiry and grace"),
      p(
        "An address accepts payment for the number of hours set in Settings, 72 by default. After that it is marked expired, but it is still watched for thirty more days, so a late payment is found and credited rather than lost. A late payment is marked **Late** in the list."
      ),
      h2("What the customer sees"),
      p(
        "Generate a reminder after issuing the address and the message carries the network, the address, the exact amount and the naira equivalent, with a warning to send that token only and on that network only. An emailed reminder also carries a QR code the customer can scan with their wallet app."
      ),
      h2("Tracking a payment"),
      img("crypto-panel.webp", "The crypto payment section on an invoice."),
      p("The section on the invoice shows the address with its QR code and a link to the block explorer, and then exactly what has happened:"),
      table(
        ["Figure", "Meaning"],
        [
          ["**Received**", "Confirmed stablecoin that has been credited against the invoice."],
          ["**Incoming, unconfirmed**", "Money that has landed on the network but is not yet deep enough to trust. Shown separately so you are never told nothing has arrived when something has."],
          ["**Still needed**", "What remains after the confirmed amount."],
        ]
      ),
      p("Each transfer is listed as **Detected**, with its confirmations counted against the number needed, then **Confirmed**. A transfer that vanished in a network reorganisation is marked **Orphaned** and not counted."),
      h3("The unusual cases"),
      ul([
        "**Part payment.** Several transfers add up. The invoice becomes Partial until the full amount has confirmed.",
        "**Overpaid.** The invoice is settled in full and the excess is recorded on the panel, so you can return it or leave it.",
        "**Wrong token.** A transfer of something other than the expected stablecoin is listed as such and does not settle the invoice.",
        "**Money with nothing owed.** If a customer pays an address after the invoice was already settled some other way, the money is recorded as unattributed and shown, never dropped.",
        "**An older balance.** If the address holds more than the listed transfers account for, a notice says so and points you at the explorer.",
      ]),
      note(
        "Send the named token only, on the named network only. Any other token, or the right token on the wrong network, is lost permanently and nobody can recover it. The panel and every reminder repeat this warning because it is the one mistake that cannot be undone.",
        "danger",
        "The one thing to get right"
      ),
      h2("Revoke an address"),
      p(
        "**Revoke address** stops watching an active address. Use it if you issued one by mistake or want to reissue on another network. Anything sent afterwards is not matched automatically, so only revoke an address the customer has not been given."
      ),
      h2("Sweep the money into your wallet"),
      p(
        "Collected stablecoin sits at each invoice address until you move it. Press **Sweep to wallet** on the invoice, or open the Wallet page and press **Collected** to sweep several at once. See [Collected payments](/docs/send-and-receive#collected-payments)."
      ),
      h2("Settings that affect this"),
      p(
        "In Settings, Crypto payments: switch the feature on or off, choose the default network, set how many hours an address accepts payment, set where swept money goes, choose how many confirmations to wait for on each network, and decide whether to be notified as soon as a payment is detected or only once it has settled. See [Settings](/docs/settings#crypto-payments)."
      ),
    ],
  },

  // --------------------------------------------------------------- MARKET --
  {
    slug: "market-watch",
    group: "market",
    title: "The Market Watch page",
    intro: "Live prices for the coins you follow, alerts that wait for your answer, and a portfolio that is simulated until you say otherwise.",
    blocks: [
      img("market-overview.webp", "Market Watch in paper mode."),
      h2("Paper and live"),
      p(
        "The switch under the title chooses between **Paper trading** and **Live wallet**. Paper is the default for everyone: a simulated portfolio that starts with one million dollars and follows real prices, so you can try the agent without risking anything. Live uses real funds from your wallet. Watches, alerts and holdings are kept separately for each, so a paper position never appears beside real money. See [Paper trading](/docs/paper-trading) and [Live trading](/docs/live-trading)."
      ),
      h2("Check now"),
      p(
        "LedgerWatch checks every watch on a schedule. **Check now** runs that check immediately and tells you how many new alerts it raised. The refresh icon beside it reloads the page's data."
      ),
      h2("The watchlist"),
      p(
        "Every coin you watch is a row: its logo and name, the live price, the change over 24 hours, and a small seven day chart. Click a column heading to sort. The label at the top right says how recently prices were updated, or **Prices delayed** when the price feed is slow. A coin whose price could not be read says **Unavailable** rather than showing a zero; your watch on it is still active."
      ),
      h2("Coin details"),
      img("market-coin.webp", "The coin detail dialog."),
      p(
        "Click a coin for a larger chart with timeframes, its market cap, 24 hour volume, high and low, your position in it, and the watches you have on it, which can be edited or removed right there."
      ),
      h2("The rest of the page"),
      ul([
        "**Simulated portfolio** (paper only): total value, profit or loss against the start, and how the value is split between holdings and cash.",
        "**Live positions** (live only): what your wallet really holds on the chosen network. See [Live trading](/docs/live-trading).",
        "**Holdings**: your simulated positions with quantity, average buy price, live price and value.",
        "**Alerts awaiting your decision** and **Alert history**. See [Watches and alerts](/docs/watches-and-alerts).",
        "**Watch a coin**, **Market agent** and **Active watches**, on the right.",
      ]),
      h2("The four tiles"),
      p(
        "In paper mode: **Cash balance** and **Total P/L** against the one million start, then **Active watches** and **Pending alerts**. In live mode the two money tiles are withheld, because a simulated figure next to real holdings would be misleading."
      ),
    ],
  },
  {
    slug: "watches-and-alerts",
    group: "market",
    title: "Watches and alerts",
    intro: "A watch is a condition on a coin's price. When it is met, the agent raises an alert with a suggestion, and you decide.",
    blocks: [
      h2("Add a watch"),
      img("market-add-watch.webp", "The watch a coin form."),
      ol([
        "Pick a coin: tap one of the quick chips, **BTC**, **ETH**, **SOL**, **BNB**, **XRP** or **DOGE**, or type any coin's name into the search box and choose it from the list. Nearly every coin listed on the major exchanges can be found.",
        "Choose the **Condition** and the value.",
        "Press **Add watch**.",
      ]),
      table(
        ["Condition", "Fires when", "Agent suggests"],
        [
          ["**Drops by %**", "The price falls by that percentage from where it was when the watch was created.", "Buy"],
          ["**Rises by %**", "The price rises by that percentage from that same starting point.", "Sell"],
          ["**Price below**", "The price is below the dollar figure you set.", "Buy"],
          ["**Price above**", "The price is above the dollar figure you set.", "Sell"],
        ]
      ),
      p(
        "For a percentage watch, the starting price is captured when the watch is created and shown under it as the **baseline**. The form shows the coin's current price so you can set a sensible figure."
      ),
      h2("The market agent"),
      img("market-agent.webp", "Asking the agent in plain language."),
      p(
        "Type what you want in plain words: **watch BTC drop 5%**, **watch ETH, SOL**, **how is my portfolio?** The agent creates the watches or answers the question. Three suggestions above the box are one tap away."
      ),
      h2("Active watches"),
      p("Every watch is listed as **when** and its condition, with the baseline where there is one. The pencil edits the condition in place; the cross stops watching."),
      h2("Alerts"),
      img("market-alerts.webp", "An alert waiting for a decision."),
      p(
        "When a condition is met, the agent raises an alert: the coin, the price at that moment, its suggestion, and a sentence explaining why. A watch that has fired waits until you have answered before it can fire again, so one condition cannot flood you."
      ),
      p("Three answers are possible:"),
      ul([
        "**Buy** or **Sell** opens the trade panel, where you choose the amount and confirm. The agent's suggestion is shown but not enforced; you can take the opposite side, and the history records that you did.",
        "**Dismiss** closes the alert with no trade.",
      ]),
      p(
        "A new alert appears within ten seconds while you are on the page, with a toast. Away from the page it arrives as a notification with **Buy** and **Sell** buttons that open the trade for you to confirm. See [Notifications](/docs/settings#notifications)."
      ),
      h2("Alert history"),
      img("market-history.webp", "The alert history."),
      p(
        "Every alert ever raised, with what the agent suggested, what you did, and the quantity and value of any trade. An alert where you went against the suggestion is marked **overrode**, so you can see over time whether the agent or your own judgement did better."
      ),
    ],
  },
  {
    slug: "paper-trading",
    group: "market",
    title: "Paper trading",
    intro: "A simulated portfolio that follows real prices. The way to try the agent before any real money is involved.",
    blocks: [
      h2("The simulated portfolio"),
      p(
        "Every account starts with one million dollars of simulated cash. Approving a buy alert opens a position at the alert's price; selling closes some or all of it. The portfolio card at the top shows the total value, the profit or loss against the start, and an allocation bar of holdings and cash."
      ),
      h2("The trade panel"),
      img("market-trade.webp", "The trade panel for a buy."),
      ol([
        "Press **Buy** or **Sell** on an alert. The panel shows the agent's recommendation and its reasoning. If you are going against it, a note says so.",
        "Choose to enter the amount in the coin or in dollars, then type it or use the **25%**, **50%**, **75%** and **MAX** buttons, which are worked out from what you have available.",
        "Read the quote: what you spend, what you receive, the price, your cash afterwards and your position afterwards.",
        "Press **Review**, check the summary, and press **Confirm**. Nothing happens until that last press.",
      ]),
      img("market-trade-confirm.webp", "The confirmation step."),
      h2("Holdings"),
      p(
        "The **Holdings** card lists every simulated position with its quantity, average buy price, live price and value. Click one to open the coin's details."
      ),
      h2("Starting again"),
      p("**Clear all my data** in Settings, Danger zone, resets the simulated portfolio to its starting cash along with the rest of your data."),
    ],
  },
  {
    slug: "live-trading",
    group: "market",
    title: "Live trading",
    intro: "The same alerts and the same trade panel, spending real funds from your own wallet through Uniswap, with caps, a full quote, and your signature on every step.",
    blocks: [
      note(
        "Live trading moves real money and prices move fast. Read this whole page, then start with an amount you would not miss. Every safeguard here stops honest mistakes; none of them stops a bad decision.",
        "danger",
        "Before you switch to live"
      ),
      h2("What you need"),
      ul([
        "A wallet on this device. See [The wallet](/docs/wallet).",
        "A real network selected. Live mode only ever shows real networks. Base is the cheapest to trade on.",
        "**USDC** or **USDT** on that network, to buy with, and a little of the network's own coin for fees. The wallet page shows both.",
      ]),
      p("Press **Live wallet** under the title. The shared demo account cannot switch; every other account can, once it has a wallet."),
      h2("Live positions"),
      img("market-live.webp", "Live positions, read from the chain."),
      p(
        "This card replaces the simulated portfolio. It reads your wallet's balances directly from the network, prices them with the same market data, and lists them with cost basis where the coin was bought here. **Trade with** chooses which dollar funds your buys, USDC or USDT, among those the network carries. A wallet with nothing on the network shows its address and a QR code to deposit to, and says plainly that the zero was read successfully rather than assumed."
      ),
      p("If the network cannot be read, the card says so. It never falls back to a simulated figure."),
      h2("A live trade, step by step"),
      ol([
        "Answer an alert with **Buy** or **Sell** and choose the amount exactly as in paper mode. The ceiling is what the wallet really holds.",
        "Press **Review**, then **Confirm**. The live trade dialog opens and fetches a quote from Uniswap on the chosen network.",
        "Read the quote: **You pay**, **You receive, about** with the fee tier it was routed through, the **Price impact**, the **Minimum received** after your slippage tolerance, and the **Network fee**.",
        "Choose a **Slippage tolerance** of 0.5%, 1% or 3%. If the price moves further than that before the trade lands, it fails and costs only the fee.",
        "If this is the first time you have sold this token here, press **Approve** and enter your wallet password. This is a separate transaction that lets the exchange move exactly this amount of the token, and no more.",
        "Enter your wallet password and press **Sign and buy** or **Sign and sell**. A link to the transaction on the block explorer appears, and the trade shows in your wallet history and in **Live trades** under the positions card.",
      ]),
      p("A signed trade carries a deadline. If the network does not include it quickly it simply expires rather than executing later at a different price."),
      h2("Price impact"),
      p(
        "Price impact is what the pool's depth costs you at your size. Above your threshold, 2% on a real network, the dialog asks you to tick a box accepting the loss before it lets you sign. A smaller amount costs less; the warning is there so the choice is yours."
      ),
      h2("The spending caps"),
      table(
        ["Cap", "Real networks", "Test networks"],
        [
          ["Per trade", "100", "1,000"],
          ["Per day, across every network", "250", "5,000"],
          ["Per session, until you reload", "150", "2,000"],
          ["Native coin kept back for fees", "0.005", "0.0005"],
          ["Price impact needing an extra tick", "2%", "5%"],
        ]
      ),
      p(
        "Amounts are in the stablecoin. The daily figure is measured from every swap this account has signed in the last 24 hours. A trade that would pass a cap is blocked with the reason and how much room is left. The caps exist to stop a mistyped amount or a runaway loop; they are not a promise about the market."
      ),
      h2("What is not traded live"),
      p(
        "A coin can be watched even when it has no pool on the chosen network. Choosing Buy on such an alert in live mode explains that it can only be traded on paper. Only the tokens verified in LedgerWatch's registry for that network are traded live."
      ),
    ],
  },

  // --------------------------------------------------------------- WALLET --
  {
    slug: "wallet",
    group: "wallet",
    title: "The wallet",
    intro: "A wallet for seven real networks, their test networks and Bitcoin, created and kept in your browser, and unlocked only by your password.",
    blocks: [
      h2("Create a wallet"),
      img("wallet-setup.webp", "The Wallet page before a wallet exists."),
      p("Open the Wallet page and press **Create a wallet**."),
      img("wallet-create-phrase.webp", "The recovery phrase step. The words are hidden in this picture; yours are shown once."),
      ol([
        "Read the note about where your keys live, then press **Show recovery phrase**.",
        "Write the twelve words down, in order, on paper. This is the only way to restore the wallet if this browser is ever cleared or this device is lost. There is also a link to show the private key, which most people do not need.",
        "Tick **I have written down my recovery phrase** and press **Continue**.",
        "Choose a wallet password of at least eight characters and confirm it. It encrypts the keys on this device and you enter it every time you send. Press **Create wallet**.",
      ]),
      note(
        "Anyone with the twelve words can take everything in the wallet. LedgerWatch will never ask for them. Never type them into another website, a chat, or a message to support.",
        "danger",
        "The phrase is the wallet"
      ),
      h2("Import a wallet"),
      img("wallet-import.webp", "Importing a wallet."),
      p("Press **Import one** to bring an existing wallet in. Three forms are accepted:"),
      ul([
        "**Recovery phrase**, twelve or twenty four words. This is the full wallet, including the ability to derive invoice payment addresses and the Bitcoin account.",
        "**Private key**, one account only. It cannot derive invoice addresses or a Bitcoin account, and LedgerWatch says so wherever that matters.",
        "**Keystore file**, the encrypted file downloaded from Settings, Wallet backup. It opens with the password it was made with.",
      ]),
      p("Every account has its own wallet. Signing into a different account on the same device shows that account's wallet, or none."),
      h2("The wallet screen"),
      img("wallet-main.webp", "The wallet on Base."),
      ul([
        "**Top left**, the network. Red when it is a real network. See [Networks](/docs/networks).",
        "**Top centre**, your account: a small pattern unique to your address and the address itself, shortened. Click it to copy the full address.",
        "**Top right**, refresh the balances, and remove the wallet from this device.",
        "**The figure**, the dollar value of everything held on this network. If any balance could not be read or has no price, a note under the figure says which, and the total is marked incomplete rather than quietly wrong.",
        "**Receive**, **Send** and **Collected** open a panel under the wallet. See [Send and receive](/docs/send-and-receive).",
        "**Tokens**, one row per token with its logo, value and quantity. The network's own coin is marked as the one that pays the fees. A row that could not be read says so instead of showing zero.",
        "**Activity**, the transactions sent from this wallet, with their status and a link to the explorer.",
        "**Hide empty balances** tidies the list. **Import a token** adds one by contract address. See [Tokens](/docs/tokens).",
      ]),
      h2("The backup notice"),
      p(
        "Until you have seen your recovery phrase, a notice at the top of the wallet asks you to back it up. Press **Do it now** to go to Settings, Wallet backup. The notice can be dismissed for the session but returns until the phrase has been revealed once."
      ),
      h2("Remove the wallet from this device"),
      p(
        "The bin icon removes the encrypted keys from this browser after you confirm. The wallet still exists on the network and can be brought back with the recovery phrase. Do this before handing a device to somebody else."
      ),
      h2("Your wallet is not on this device"),
      p(
        "If your account has a wallet but this browser does not hold its keys, the Wallet page says so and offers **Import with recovery phrase**. This happens on a new computer, a new phone, or after clearing the browser's data."
      ),
    ],
  },
  {
    slug: "networks",
    group: "wallet",
    title: "Networks",
    intro: "One address on every network, but a separate balance on each. Understanding this prevents the commonest costly mistake.",
    blocks: [
      img("wallet-networks.webp", "The network menu, with your balance on each."),
      h2("The networks"),
      table(
        ["Real networks", "Test networks"],
        [
          ["Ethereum, Base, Arbitrum, Optimism, Polygon, BNB Chain, Avalanche", "Sepolia, Base Sepolia, Arbitrum Sepolia, Optimism Sepolia, Polygon Amoy"],
          ["Bitcoin", "Bitcoin Testnet"],
        ]
      ),
      p(
        "Open the menu at the top left of the wallet. Real networks are listed first, then test networks, each with your balance of the network's own coin so you can see where your funds are without visiting each one. A **swaps** chip marks a network where live trading is available."
      ),
      h2("One address, every network"),
      p(
        "Your wallet address is the same on every network in the first row, so you never need a separate wallet per chain. Bitcoin is different: it has its own address, beginning bc1, derived from the same recovery phrase."
      ),
      note(
        "Balances are per network and do not move between them. Funds on Base stay on Base. Sending to your own address does not carry them to another network; it returns them to you on the same one and costs a fee. Moving assets between networks needs a bridge, and LedgerWatch links to the official one for each network from the Send and Receive panels.",
        "warn",
        "The mistake to avoid"
      ),
      h2("Real and test"),
      p(
        "Test networks use coins that are free and worthless, handed out by faucets, and exist so you can practise every action here without risk. Real networks use real money. The network name is on every screen, the network pill turns red on a real network, and every send names the network in its summary before you sign."
      ),
      h2("Getting test coins"),
      p(
        "Choose a test network, press **Receive**, copy the address, and paste it into that network's faucet. The Receive panel links to the faucet where one is known. Test USDC for practising invoice payments is available from the Circle faucet for each test network."
      ),
      h2("Fees"),
      p(
        "Every transaction pays a fee in the network's own coin: ETH on Ethereum, Base, Arbitrum and Optimism, POL on Polygon, BNB on BNB Chain, AVAX on Avalanche, BTC on Bitcoin. Keep a little of it on any network you use, or nothing can be sent from it. LedgerWatch checks before every send and tells you exactly how much is short if it cannot be paid."
      ),
    ],
  },
  {
    slug: "send-and-receive",
    group: "wallet",
    title: "Send, receive and collected payments",
    intro: "The three panels under the wallet, and the review step that stands between you and every transaction.",
    blocks: [
      h2("Receive"),
      img("wallet-receive.webp", "The Receive panel."),
      p(
        "Press **Receive**. The panel shows your address as text and as a QR code, with **Copy address**. It names the network and repeats that anything sent on a different network will not appear here. Give the sender both the address and the network."
      ),
      h2("Send"),
      img("wallet-send.webp", "The Send form."),
      ol([
        "Press **Send**. Enter the **Recipient address**, the **Amount**, and choose the **Asset**: the network's own coin or one of its tokens.",
        "Press **Review transaction**. LedgerWatch estimates the fee and checks the wallet can pay it.",
        "Read the summary: the network, the asset, the recipient, the amount and the estimated fee. If the fee cannot be paid, the summary says how much of the network's coin is short and the password box is withheld.",
        "Enter your **wallet password** and press **Sign & send**. The key is decrypted in your browser for this one signature and discarded.",
      ]),
      img("wallet-send-review.webp", "The review step, with the network named first."),
      p("The transaction appears under **Activity** as pending, then confirmed or failed, with a link to the explorer. A toast names the network so a transfer can never be mistaken for a move between networks."),
      h3("Two mistakes LedgerWatch refuses"),
      ul([
        "**Sending to your own address.** It costs a fee and moves nothing. People do it when trying to move funds to another network; the form explains and points at the bridge instead.",
        "**Sending to a known contract.** Sending tokens to a token's own contract or to the exchange router destroys them. The form recognises those addresses and refuses.",
      ]),
      h2("Collected payments"),
      img("wallet-collected.webp", "The Collected panel."),
      p(
        "Press **Collected**. Every invoice payment address on this network that holds money is listed, with the customer, the balance read live from the network, and its naira value at the rate the invoice was quoted. Tick the ones to move, or **Select all**, and press **Sweep**."
      ),
      h3("The sweep dialog"),
      ol([
        "Each address is listed with its amount. The totals show what will move, its naira value, and the destination: this wallet, or the sweep destination set in Settings, in which case a warning asks you to check it.",
        "An invoice address holds only stablecoin and cannot pay its own fee, so your main wallet first sends it a little of the network's coin. The dialog says how much and that it is a separate transaction you are approving.",
        "Enter your **wallet password** once for the whole batch and press **Sign and sweep**. Each transfer is signed and sent in turn, with its progress shown on its row.",
      ]),
      p("Swept money lands in your main wallet on the same network, and the balances update."),
    ],
  },
  {
    slug: "tokens",
    group: "wallet",
    title: "Tokens",
    intro: "The tokens the wallet shows, how to add one, and what happens when a token you never asked for arrives.",
    blocks: [
      h2("The verified list"),
      p(
        "Each network comes with the tokens LedgerWatch has verified on that network: the stablecoins, wrapped bitcoin and ether, and a few others. Their balances are read from the network every time the wallet opens."
      ),
      h2("Import a token"),
      img("wallet-import-token.webp", "Adding a token by contract address."),
      ol([
        "Press **Import a token** at the foot of the token list.",
        "Paste the token's **contract address** on this network and press **Look up**. LedgerWatch reads the symbol, the decimals and your balance from the contract itself. Nothing is assumed from the name.",
        "Read the warning, then press **Add**. The token appears in your list with an **added** label, on every device you sign into.",
      ]),
      note(
        "Anyone can deploy a contract and call it USDC. LedgerWatch only reports what a contract says about itself. Add a token only if you know where the address came from, and check it on the explorer first.",
        "warn"
      ),
      h2("Tokens that arrive uninvited"),
      p(
        "When the wallet opens, LedgerWatch reads every token transfer sent to your address since it last looked. A token you never added is shown in a card above the list with what arrived, when, from which address, and a link to the contract on the explorer."
      ),
      ul([
        "**Add** shows it in your wallet, with decimals read from the contract.",
        "**Ignore** keeps it off your lists. Ignored tokens can be shown again and restored.",
        "A token whose contract could not be read cannot be added, because its balance could not be shown correctly.",
      ]),
      p(
        "Nothing is added by itself. On a real network most unsolicited tokens are spam or bait. A token whose symbol copies a verified token on that network, but is not that contract, is flagged as an impersonation and should be treated as bait unless you know who sent it."
      ),
      h2("Token details"),
      p(
        "Click any row. A token the price feed knows opens the same detail dialog as the Market Watch page, with a chart and your position. A token it does not know shows the network, the balance read from the chain, its value if a price exists, and the contract address."
      ),
    ],
  },
  {
    slug: "bitcoin",
    group: "wallet",
    title: "Bitcoin",
    intro: "Real Bitcoin, from the same recovery phrase, with fees you choose and sends you can speed up or cancel while they wait.",
    blocks: [
      h2("Set it up once"),
      img("wallet-bitcoin-setup.webp", "Unlocking once to derive the Bitcoin address."),
      p(
        "Choose **Bitcoin** or **Bitcoin Testnet** in the network menu. The first time, enter your wallet password once. Your Bitcoin address is derived from the recovery phrase and remembered on this device; the key is not stored and every send asks for the password again. A wallet imported from a private key alone has no phrase and cannot set up Bitcoin."
      ),
      h2("The Bitcoin screen"),
      img("wallet-bitcoin.webp", "The Bitcoin wallet."),
      p(
        "The address, beginning bc1 on the real network and tb1 on testnet, is at the top; click it to copy. The balance is shown in BTC, with any amount still confirming named separately. **Holdings** shows the balance in satoshis; **Activity** lists recent transactions with links to the explorer."
      ),
      h2("Receive"),
      p("Press **Receive** for the address. Send only Bitcoin to it, on the Bitcoin network. It is not an Ethereum address, and coins sent from another network will not arrive."),
      h2("Send"),
      img("wallet-bitcoin-send.webp", "Sending Bitcoin: the form and the review."),
      ol([
        "Press **Send**. Enter the destination, which is checked as you type, and the amount in BTC. Amounts below the dust limit are refused because the network will not relay them.",
        "Choose a fee: **Fast**, **Normal** or **Slow**, each showing the current rate in satoshis per vbyte, fetched for this network and refreshed before every send. The fee goes to miners.",
        "Press **Review**. The summary shows the exact fee, what leaves the wallet, which coins are used, what returns as change, and the balance afterwards. Nothing has been signed.",
        "Enter your **wallet password** and press **Sign and send**. What you reviewed is what is signed, to the satoshi.",
      ]),
      note("Bitcoin cannot be reversed. Check the address character by character before you sign.", "danger"),
      h2("Speed up or cancel"),
      p(
        "While a send is unconfirmed, a banner in **Activity** offers **Speed up**, which replaces it with the same payment at a higher fee, and **Cancel**, which replaces it with a payment back to your own wallet. Either asks for a new fee rate and your password. The network keeps whichever version it mines first, and the controls disappear the moment the send confirms."
      ),
      h2("When the network does not answer"),
      p(
        "Very rarely the network does not say whether it accepted a send. LedgerWatch shows this as its own state rather than as an error, keeps the transaction id, offers **Check the address now**, and will not let you send again until you have confirmed the first copy is not there. This is what stops a payment being sent twice."
      ),
    ],
  },

  // ------------------------------------------------------------- SETTINGS --
  {
    slug: "settings",
    group: "settings",
    title: "Settings",
    intro: "Seven sections, in the list on the left. On a phone they run along the top.",
    blocks: [
      h2("Profile"),
      img("settings-profile.webp", "Profile."),
      p(
        "Your picture, which is cropped to a square and shown beside your name; your display name; and your company name, which appears on reminders and statements. Your email is shown but cannot be changed here."
      ),
      h2("Payout details"),
      img("settings-payout.webp", "Payout details."),
      p("The account name, account number and bank name that go inside every reminder, so a customer never has to ask where to pay. Fill these in before sending your first reminder."),
      h2("Crypto payments"),
      img("settings-crypto.webp", "Crypto payment settings."),
      ul([
        "**Offer crypto payment on invoices.** Off hides the action and stops new addresses being issued. Addresses already issued keep being watched.",
        "**Notify me as soon as a payment is detected.** Off means you are told only once it has confirmed and settled.",
        "**Default network** for new addresses, and **Accept payment for (hours)**, between 1 and 720. After that an address is still watched for thirty days.",
        "**Sweep destination.** Blank means the wallet on this device. Anything else is checked against you carefully in the sweep dialog, because a transfer to a wrong address cannot be reversed.",
        "**Confirmations before settling**, per network. Blank uses the recommended depth. Setting one lower settles faster and risks a reorganised transaction being counted; the page warns you when you do.",
      ]),
      h2("Security"),
      img("settings-security.webp", "Changing the sign in password."),
      p(
        "Change the password you sign in with. It must be at least eight characters and different from the current one. Changing it signs every other device out. Your wallet password is separate and is not affected."
      ),
      h2("Wallet backup"),
      p("The screen that stops the wallet being a trap. See [Backup and recovery](/docs/backup-and-recovery)."),
      h2("Notifications"),
      img("settings-notifications.webp", "Notifications."),
      h3("On this device"),
      p(
        "The current browser permission is shown as a pill. **Enable notifications** asks the browser for permission and registers this device. **Send test notification** proves it works; the test appears when this tab is not in front, because while it is in front you get a toast instead. Then choose what to be told about: **Market alerts**, **Reminders due** and **Transaction updates**."
      ),
      p("If Chrome has blocked notifications for the site, it will not ask again; the page explains how to allow them from the address bar and try again."),
      h3("Automatic reminders"),
      p(
        "**Send reminders automatically** lets LedgerWatch send due reminders itself, over **WhatsApp**, **Email** or both. Off by default. A note explains why reminders sent from a personal Gmail address often land in spam, and what a properly set up domain needs."
      ),
      h2("Danger zone"),
      img("settings-danger.webp", "The danger zone."),
      ul([
        "**Clear all my data** deletes every invoice, payment, reminder, watch and alert, and resets the simulated portfolio. Your login, profile and payout details are kept. Type **CLEAR** to confirm.",
        "**Delete my account** removes the account and everything in it and signs you out. Type **DELETE** to confirm.",
      ]),
      p("Neither touches the wallet, which lives in your browser. Remove that from the Wallet page, after backing up the phrase."),
    ],
  },
  {
    slug: "backup-and-recovery",
    group: "settings",
    title: "Backup and recovery",
    intro: "Your wallet is encrypted in this browser only. Backing it up is the one thing that makes it survive a lost phone or a cleared browser.",
    blocks: [
      img("settings-backup.webp", "Wallet backup."),
      h2("Three ways to back up"),
      table(
        ["Option", "What it gives you"],
        [
          ["**Reveal secret recovery phrase**", "Twelve words that restore the whole wallet, including every invoice payment address and the Bitcoin account. Write them on paper."],
          ["**Export private key**", "One account only. It does not restore the rest of the wallet."],
          ["**Download encrypted keystore**", "An encrypted file that opens only with your wallet password. Safe to keep in cloud storage or email to yourself, unlike the phrase."],
        ]
      ),
      h2("Revealing the phrase"),
      img("settings-backup-reveal.webp", "The warning before a reveal."),
      ol([
        "Read the warning and press **I understand, continue**.",
        "Enter your wallet password, and your extra verification answers if you set them up, then press **Unlock and reveal**. Unlocking takes a few seconds on purpose.",
        "Press **Tap to reveal** when nobody can see your screen and you are not sharing it. The words appear, numbered, and hide again by themselves after sixty seconds. **Copy** puts them on the clipboard, which other programs can read, so copy something else afterwards.",
      ]),
      p("The reveal happens entirely in your browser. Nothing secret is sent anywhere, written to a log, or stored anywhere but your own device."),
      h2("Extra verification"),
      p(
        "You can add three or more security questions that are asked alongside your wallet password before a reveal. Answers are hashed before they are stored, so nobody, including LedgerWatch, can read them back. This is an extra lock, not a spare key: it cannot recover a forgotten password, because the password never reaches the server."
      ),
      h2("Restoring on another device"),
      p(
        "Sign in, open the Wallet page, press **Import with recovery phrase**, type the twelve words and choose a wallet password for that device. The same address, balances, invoice addresses and Bitcoin account come back. A keystore file works the same way with the password it was made with."
      ),
      note(
        "If you lose both the recovery phrase and the device holding the encrypted keys, the funds are gone. Not stolen, just unreachable, and nobody can bring them back. Back up before you deposit.",
        "danger",
        "What cannot be recovered"
      ),
    ],
  },

  // ----------------------------------------------------------------- HELP --
  {
    slug: "safety",
    group: "help",
    title: "Keeping your money safe",
    intro: "What LedgerWatch does to protect you, what it cannot do, and the habits that matter more than any of it.",
    blocks: [
      h2("How LedgerWatch is built"),
      ul([
        "Your wallet keys are created in your browser, encrypted with your wallet password, and never leave your device. The server stores only your public address.",
        "Every transaction is signed in your browser with a password typed for that transaction. The server has nothing to sign with, so no bug, breach or employee could move your funds through it.",
        "Your sign in password is stored as a hash, never in plain text. Changing it signs every other device out.",
        "Sign in, sign up and password reset are protected by a human check and by rate limits, and the reset code expires in fifteen minutes.",
        "The page forbids scripts from any origin but its own, so the sign in page cannot be tampered with by a stray script.",
      ]),
      h2("What that means LedgerWatch cannot do"),
      ul([
        "It cannot reverse a transaction. Nobody can, on any network.",
        "It cannot recover a lost recovery phrase or reset a forgotten wallet password.",
        "It cannot freeze or move your funds, for you or for anyone else.",
      ]),
      h2("The habits that matter"),
      ol([
        "**Write the recovery phrase on paper the day you create the wallet**, and keep it somewhere only you can reach. Not a photo, not a note on your phone.",
        "**Never share the phrase or a private key with anyone**, for any reason. LedgerWatch will never ask. Support will never ask. Anyone who does is trying to steal from you.",
        "**Check addresses character by character** before you sign. A transfer to a wrong address is permanent.",
        "**Check the network** on every send and every payment address. The right token on the wrong network is lost.",
        "**Send a small amount first** to any new address, and to any new network, before sending a large one.",
        "**Practise on a test network** until every screen is familiar. The coins are free.",
        "**Keep a little of the network's coin** on every network you use, so funds are never stuck for want of a fee.",
        "**Sign out on shared devices**, and remove the wallet from a device before you give it away.",
        "**Keep your sign in password and your wallet password different**, and both strong.",
      ]),
      h2("Recognising a scam"),
      p(
        "A message claiming to be from LedgerWatch that asks for your phrase, your key or your password is a scam. A token that appears in your wallet that you did not buy is almost always bait, and one that copies the name of a real token is flagged as such. A website that looks like LedgerWatch at a different address is not LedgerWatch; the address is useledgerwatch.co."
      ),
      h2("Reporting a security problem"),
      p("If you find a weakness, write through the [Contact page](/contact) and choose **A security concern**. Please do not publish it until it has been fixed."),
    ],
  },
  {
    slug: "troubleshooting",
    group: "help",
    title: "Troubleshooting",
    intro: "The problems people run into most, and what to do about each.",
    blocks: [
      h2("Signing in"),
      h3("The code has not arrived"),
      p(
        "Check the spam folder, wait a minute, then press **Send a new code**. A code is valid for thirty minutes at sign up and fifteen for a password reset, and the screen says when one has expired rather than when it was mistyped."
      ),
      h3("That sign in did not start in this browser"),
      p(
        "Google sign in only completes in the browser that started it. Press **Continue with Google** here rather than following a link from somewhere else."
      ),
      h3("Too many attempts"),
      p("Sign in and code entry are rate limited. Wait the number of minutes the message gives and try again."),
      h2("The wallet"),
      h3("Balance unavailable"),
      p(
        "The network did not answer. This is a connection problem, not an empty wallet; your funds are untouched. Press the refresh icon, or try again in a minute. A single token that could not be read is marked on its own row while the others show normally."
      ),
      h3("Your wallet is not on this device"),
      p("The account has a wallet but this browser does not hold its keys. Import it with the recovery phrase. See [Backup and recovery](/docs/backup-and-recovery)."),
      h3("I forgot my wallet password"),
      p(
        "It cannot be reset, because it never reaches the server. Remove the wallet from the device and import it again with the recovery phrase, choosing a new password. Without the phrase, the wallet cannot be recovered."
      ),
      h3("Not enough ETH, or not enough of the network's coin"),
      p("Every transaction pays a fee in the network's own coin. Deposit a small amount of it on that network and try again. The message says how much is short."),
      h3("I sent funds and the balance did not change"),
      p(
        "Check the network. Funds sent on one network appear only on that network; open the menu and look at the balance on the one you sent on. If you sent to your own address, the funds came straight back on the same network, minus the fee."
      ),
      h3("A token I did not buy appeared"),
      p("It arrived uninvited. Do not add it unless you know who sent it, and never visit a website it advertises. See [Tokens](/docs/tokens)."),
      h2("Crypto payments"),
      h3("The customer paid but nothing shows"),
      ul([
        "Ask them for the transaction hash and open it on the explorer. Check the token, the network and the address match what they were given.",
        "A payment is listed as **Detected** within a few minutes of landing and becomes **Confirmed** after the number of confirmations shown. A busy network can take longer.",
        "A payment after expiry is still found for thirty days and marked **Late**.",
        "The wrong token, or the right token on the wrong network, is not recoverable. The panel lists a wrong token so you can see it happened.",
      ]),
      h3("I cannot create a payment address"),
      p(
        "You need a wallet on this device, created or imported with its recovery phrase, and crypto payments switched on in Settings. A wallet imported from a private key alone cannot derive addresses; import the phrase instead."
      ),
      h2("Market Watch"),
      h3("Prices delayed or unavailable"),
      p("The price feed is slow or rate limited. Your watches are still active and are checked with the next prices that arrive. Try again in a few minutes."),
      h3("The Buy button says the coin can only be traded on paper"),
      p("That coin has no verified pool on the selected network. Watching still works. See [Live trading](/docs/live-trading)."),
      h3("A trade was blocked by a cap"),
      p("The message says which cap and how much room is left. Lower the amount, or wait for the daily window to pass."),
      h2("Reminders"),
      h3("The send was skipped"),
      p("The channel is not set up on the server. Use **Open in WhatsApp** to send from your own phone, or ask the person running your LedgerWatch to configure the provider."),
      h3("Reminders land in the customer's spam folder"),
      p("Mail sent on behalf of a personal Gmail address is often treated as suspicious. The fix is a domain you own with the right records, described under Notifications in Settings."),
      h2("Notifications"),
      h3("Nothing happens when I press enable"),
      p("Chrome remembers a block. Click the icon at the left of the address bar, open Site settings, set Notifications to Allow, reload, and press enable again."),
      h3("No notifications on an iPhone"),
      p("Add LedgerWatch to the home screen and open it from there. Notifications need iOS 16.4 or later and the installed app."),
      h2("Still stuck"),
      p("Write through the [Contact page](/contact). Say what happened, what you expected, and when. For anything involving a transaction, include the network and the transaction hash. Never include a password, a phrase or a private key."),
    ],
  },
  {
    slug: "glossary",
    group: "help",
    title: "Glossary",
    intro: "The words this guide uses, in plain terms.",
    blocks: [
      table(
        ["Term", "Meaning"],
        [
          ["**Address**", "The public identifier of a wallet on a network. Safe to share; it is where money is sent to."],
          ["**Baseline**", "The price a coin had when a percentage watch was created. The percentage is measured from it."],
          ["**Bridge**", "A service that moves assets from one network to another. LedgerWatch does not do this itself."],
          ["**Confirmation**", "A block added to the network after the one containing your transaction. More confirmations mean it is less likely to be undone."],
          ["**Contract**", "A program on a network. Every token is one. Sending tokens to a contract address usually destroys them."],
          ["**Debtor**", "A customer who owes you money."],
          ["**Explorer**", "A public website that shows every transaction on a network. LedgerWatch links to the right one for each network."],
          ["**Fee tier**", "The pool on Uniswap a swap is routed through. LedgerWatch quotes every tier and picks the best."],
          ["**Gas**", "The fee paid to a network to process a transaction, in the network's own coin."],
          ["**Keystore**", "The encrypted file that holds a wallet's keys. It opens only with the wallet password."],
          ["**Mainnet**", "A real network, where money is real."],
          ["**Paper trading**", "Trading with simulated money that follows real prices."],
          ["**Price impact**", "How much your own trade moves the price against you, because of the size of the pool."],
          ["**Private key**", "The secret that controls one account. Anyone who has it controls the funds."],
          ["**Recovery phrase**", "Twelve words from which every key in the wallet is derived. The complete backup."],
          ["**Reorganisation**", "When a network discards recent blocks in favour of others. A shallow transaction can vanish; confirmations protect against it."],
          ["**Slippage**", "How far the price may move between the quote and the trade before the trade is abandoned."],
          ["**Stablecoin**", "A token that tracks the dollar, such as USDC or USDT."],
          ["**Sweep**", "Moving collected invoice payments from their addresses into your main wallet."],
          ["**Testnet**", "A practice network whose coins are free and worthless."],
          ["**Watch**", "A condition on a coin's price that raises an alert when it is met."],
        ]
      ),
    ],
  },
];
