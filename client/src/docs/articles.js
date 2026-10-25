const h2 = (text) => ({ type: "h2", text });
const p = (text) => ({ type: "p", text });
const ul = (items) => ({ type: "ul", items });
const ol = (items) => ({ type: "ol", items, steps: true });
const note = (text, tone, title) => ({ type: "callout", text, tone, title });
const table = (head, rows) => ({ type: "table", head, rows });

export const ARTICLES = [
  {
    slug: "polite-payment-reminders",
    title: "How to remind a customer to pay without losing them",
    intro:
      "Most late payers are not refusing to pay. They forgot, they are short this week, or your invoice is buried in their chats. A good reminder makes paying easy and keeps the relationship warm.",
    blocks: [
      h2("Start from the assumption that they mean to pay"),
      p(
        "The first reminder should read like a note from a supplier who values the customer, not like a demand. People respond to being treated as honest. If you open with suspicion, you give them a reason to delay and a reason to buy from someone else next time."
      ),
      h2("Put everything they need in the message itself"),
      p("A reminder that makes the customer ask a question will wait until they have time to ask it. Include:"),
      ul([
        "**Who it is from**, by business name, so they recognise it at a glance.",
        "**What it is for**: the invoice number, what you supplied, and when.",
        "**How much**, written in full, with the balance if they have already paid part.",
        "**When it was due**, as a date rather than \"last month\".",
        "**How to pay**: your account name, bank and account number, or a link where they can see the invoice and pay.",
      ]),
      h2("Choose the tone by how late it is"),
      table(
        ["How late", "Tone", "What to say"],
        [
          ["Due in a few days", "Friendly", "A heads up that the payment is coming due, with the details."],
          ["A week late", "Warm and direct", "A gentle reminder that it has passed, and an easy way to pay today."],
          ["Two to four weeks late", "Firm and polite", "A clear request for payment by a date, and an offer to talk if there is a problem."],
          ["Over a month late", "Formal", "A final reminder that states the amount, the history, and what happens next."],
        ]
      ),
      h2("Make the next step tiny"),
      p(
        "The easiest reminder to act on ends with one obvious thing to do: transfer to this account, or open this link. Avoid asking them to call you back, find the original invoice, or reply with a question."
      ),
      h2("Keep a record of every reminder"),
      p(
        "Write down when you reminded, how, and what they said. If a customer later disputes the debt, a calm record of polite reminders is worth more than any argument. It also stops you reminding the same person twice in one day by accident."
      ),
      note(
        "LedgerWatch drafts each reminder in the right tone for how late the invoice is, adds your bank details and a payment page link, and keeps the log for you. See [Reminders](/docs/reminders) in the guide.",
        null,
        "Doing this in LedgerWatch"
      ),
    ],
  },
  {
    slug: "whatsapp-payment-reminder-messages",
    title: "WhatsApp payment reminder messages you can copy",
    intro:
      "In Nigeria a payment reminder is usually a WhatsApp message. Here are short, polite messages for each stage of a late invoice, ready to copy and adjust.",
    blocks: [
      h2("Before the due date"),
      p(
        "Good morning Mrs Adeyemi. This is Chidi from Chidi Electrics. Just a reminder that invoice INV-0012 for the cables we delivered on 3 March, ₦85,000, is due on Friday. You can pay into Chidi Electrics Ltd, Zenith Bank, 1234567890. Thank you for your business."
      ),
      h2("A few days late"),
      p(
        "Hello Mrs Adeyemi, I hope you are well. Invoice INV-0012 for ₦85,000 was due on Friday and I have not seen it come in yet. If you have already paid, please send me the receipt and I will update my records. If not, you can pay into Chidi Electrics Ltd, Zenith Bank, 1234567890. Thank you."
      ),
      h2("Two weeks late"),
      p(
        "Good afternoon Mrs Adeyemi. I am following up on invoice INV-0012 for ₦85,000, which is now two weeks past due. Could you let me know when to expect it? If something has come up, tell me and we can agree a plan. Account: Chidi Electrics Ltd, Zenith Bank, 1234567890."
      ),
      h2("A month or more late"),
      p(
        "Dear Mrs Adeyemi, this is a final reminder about invoice INV-0012 for ₦85,000, due on 7 March and still unpaid. Please settle it by 30 April, or call me before then so we can agree a way forward. Account: Chidi Electrics Ltd, Zenith Bank, 1234567890."
      ),
      h2("When they have paid part"),
      p(
        "Thank you for the ₦40,000 you sent yesterday, Mrs Adeyemi. That leaves ₦45,000 on invoice INV-0012. Whenever you are ready, the same account works: Chidi Electrics Ltd, Zenith Bank, 1234567890."
      ),
      h2("Things that make WhatsApp reminders work"),
      ul([
        "Send them in the morning or early afternoon on a weekday, when people are at work and handling payments.",
        "Keep each one short enough to read without scrolling.",
        "Always include the account details in the message, even if you sent them before.",
        "Thank them when they pay, every time. It is the cheapest way to get paid faster next time.",
      ]),
      note(
        "Sending from your own WhatsApp is free and personal. Sending automatically from a business number needs the WhatsApp Business Platform, which asks you to register message templates with Meta first, and Meta charges for business messages. See [Reminders](/docs/reminders) for how LedgerWatch handles both.",
        null,
        "Sending them automatically"
      ),
    ],
  },
  {
    slug: "invoice-reminder-schedule",
    title: "A simple invoice reminder schedule for small businesses",
    intro:
      "The businesses that get paid on time are not the ones with the sternest reminders. They are the ones that remind on a steady schedule, every time, without forgetting.",
    blocks: [
      h2("A schedule that works for most invoices"),
      ol([
        "**The day you issue the invoice.** Send it with the amount, the due date and how to pay.",
        "**Three days before it is due.** A short, friendly heads up.",
        "**The day after it is due.** A polite note that it has passed, with the account details again.",
        "**Every three to seven days after that.** Shorter, firmer reminders, each with the balance.",
        "**After a month.** A final reminder with a clear date, then a phone call.",
      ]),
      h2("Adjust it to the customer"),
      table(
        ["Customer", "Change"],
        [
          ["Pays on time, every time", "Skip the reminder before the due date. A thank you after payment is enough."],
          ["Usually a little late", "Keep the full schedule, but stay warm. They are not the problem."],
          ["Large invoice, slow payer", "Agree part payments up front, and remind before each part is due."],
          ["A new customer", "Ask for a deposit on the first order until you know how they pay."],
        ]
      ),
      h2("Do not let the schedule live in your head"),
      p(
        "The schedule fails when it depends on you remembering. Busy weeks are exactly when invoices go unchased. Put each invoice somewhere that tells you, every morning, who is due a reminder today."
      ),
      h2("Know your numbers"),
      p(
        "Once a month, look at how much is owed to you, how much of it is more than thirty days late, and who your slowest payers are. Those three numbers tell you whether to tighten credit, ask for deposits, or simply chase more often."
      ),
      note(
        "LedgerWatch keeps a reminder interval on every invoice, can send reminders automatically, and shows your ageing and collection rate on the Overview. See [Debts](/docs/debts) and [Reminders](/docs/reminders).",
        null,
        "Doing this in LedgerWatch"
      ),
    ],
  },
  {
    slug: "accept-usdc-payments-nigeria",
    title: "Accepting USDC payments as a Nigerian business",
    intro:
      "Some customers, especially those abroad, would rather pay in a dollar stablecoin than by bank transfer. Here is what accepting USDC involves, what to watch for, and how to keep it simple.",
    blocks: [
      h2("What USDC is"),
      p(
        "USDC is a token designed to stay worth one US dollar. It moves on public blockchains such as Base, Ethereum and Polygon, arrives in minutes, and works the same for a customer in Lagos or London. You receive it into a wallet address, not a bank account."
      ),
      h2("Why a business might accept it"),
      ul([
        "Customers abroad can pay without international transfer fees or long waits.",
        "It is held in dollars, which some businesses use to protect part of their income from naira swings.",
        "Every payment is visible on the blockchain, so there is no question about whether it was sent.",
      ]),
      h2("What to watch for"),
      ul([
        "**The network matters.** USDC sent on the wrong network, or to the wrong address, may be lost. Always tell the customer exactly which network to use.",
        "**The rate.** Agree how naira converts to USDC before they pay, and record the rate you used.",
        "**Fees.** Moving USDC costs a small network fee, paid in that network's own coin.",
        "**Your keys.** If you hold the wallet yourself, nobody can recover it for you. Write down the recovery phrase and keep it offline.",
        "**The rules.** Nigeria's Investments and Securities Act 2025 treats digital assets as securities, and the SEC registers businesses that provide crypto services to others. Accepting payment for your own goods is different from running an exchange, but take advice for your own situation.",
      ]),
      note(
        "This article explains how stablecoin payments work. It is not legal, tax or financial advice. Speak to a Nigerian lawyer or accountant about your own business before you start.",
        "warn",
        "Not legal advice"
      ),
      h2("A simple way to do it"),
      ol([
        "Give each invoice its own payment address, so you always know which customer paid.",
        "Fix the amount in USDC at the moment you send the invoice, at a stated rate.",
        "Tell the customer the network and the exact amount, in writing.",
        "Wait for the payment to be confirmed on the blockchain before you treat it as paid.",
        "Move the money to your main wallet, and convert it to naira when you choose.",
      ]),
      note(
        "LedgerWatch issues a unique address for each invoice from your own wallet, fixes the rate when the address is issued, watches the blockchain, and marks the invoice paid once the payment confirms. The money goes straight to an address only you control. See [Crypto payments](/docs/crypto-payments).",
        null,
        "Doing this in LedgerWatch"
      ),
    ],
  },
  {
    slug: "track-who-owes-you-money",
    title: "How to keep track of who owes you money",
    intro:
      "A notebook works until the day you lose it, and a spreadsheet works until two people edit it. Here is a simple way to always know who owes you, how much, and since when.",
    blocks: [
      h2("Record every sale on credit the day it happens"),
      p(
        "The most common reason debts go unpaid is that nobody wrote them down at the time. Record the customer, the amount, what it was for, and when it is due, before the goods leave your shop."
      ),
      h2("Keep one record per invoice, not per customer"),
      p(
        "A customer with three open invoices owes three separate amounts, each with its own due date. Keeping them separate tells you which one is late, and lets you record part payments against the right one."
      ),
      h2("Record payments as they arrive"),
      p(
        "When money comes in, record it against the invoice straight away, with the date and how it was paid. Your balance is only as accurate as your last recorded payment."
      ),
      h2("Look at your customers, not just your invoices"),
      table(
        ["What to look at", "Why it matters"],
        [
          ["Total owed by each customer", "Shows who you depend on, and who you should not extend more credit to yet."],
          ["How late they usually pay", "Tells you who needs an earlier reminder."],
          ["How much they have paid over time", "Shows your best customers, who deserve the most patience."],
        ]
      ),
      h2("Give every customer a statement"),
      p(
        "Once a month, or whenever they ask, send each customer a statement of what they bought, what they paid, and what they still owe. It settles disagreements before they start."
      ),
      note(
        "LedgerWatch keeps every invoice, payment and reminder, groups them by customer with a reliability score, and makes a statement you can print or send. See [Debtors](/docs/debtors).",
        null,
        "Doing this in LedgerWatch"
      ),
    ],
  },
];
