/**
 * The privacy policy and the terms, as the owner wrote them.
 *
 * Kept as data so they read as documents and render through the same blocks
 * as the guide. House style: plain words, first person, no dashes anywhere.
 */

const h2 = (text) => ({ type: "h2", text });
const p = (text) => ({ type: "p", text });
const ul = (items) => ({ type: "ul", items });

export const PRIVACY = {
  title: "Privacy policy",
  meta: "Last updated 5 September 2026. Written by Eberechukwu Uchechukwu Gerald, who built and runs LedgerWatch.",
  blocks: [
    p(
      "I built LedgerWatch on my own, and I run it on my own. So this is not a document a law firm wrote for me. It is me telling you, as plainly as I can, what the product knows about you, what it does with that, and what it will never do. If anything here is unclear, write to me through the Contact page and I will answer you myself."
    ),

    h2("Who I am"),
    p(
      "LedgerWatch is made and operated by me, Eberechukwu Uchechukwu Gerald. I live and work in Nigeria, and the product runs at useledgerwatch.co. When this policy says I or me, it means me personally, because there is nobody else."
    ),

    h2("What this policy covers"),
    p(
      "It covers the website at useledgerwatch.co and the application you sign into there. It does not cover other websites I link to, such as block explorers, faucets, bridges or Google, which have their own policies."
    ),

    h2("What I collect, and why"),
    p("I keep the minimum the product needs to work. Here is all of it."),
    ul([
      "**Your account.** Your name, your email address, and your password stored as a hash, which is a scrambled form I cannot reverse. If you sign in with Google, I store the identifier Google gives me for you and I do not receive your Google password. You may also add a profile picture and a company name.",
      "**Your payout details.** The account name, account number and bank name you type in Settings. They exist for one purpose, which is to appear inside the reminders you send, so your customers know where to pay you.",
      "**Your ledger.** The debts you record and everything about them: the customer's name, phone number and email address if you give one, the amount, the due date, notes, the payments recorded against it, and the reminders that were generated and where they were sent.",
      "**Your wallet's public side.** Your wallet's public address, the transactions you send from it, the tokens you add, the tokens that arrive at it, and the payment addresses issued for your invoices. All of this is public on the blockchain anyway. I keep it so the wallet can show you your own history.",
      "**Market Watch.** The coins you watch, the conditions you set, the alerts raised, your paper trades, and a record of each live swap you sign.",
      "**Notifications.** If you enable them, the subscription your browser gives me so I can reach that device. It includes the kind of browser it is.",
      "**Messages you send me.** Anything you write through the Contact page, with your name and email so I can reply.",
      "**Technical facts.** Your internet address is used, in memory and only for a short while, to limit how many times a form can be submitted. I do not keep it in the database. I do not use analytics scripts, advertising trackers or fingerprinting of any kind.",
    ]),

    h2("What I never collect"),
    p("This part matters more than the rest, so I want it to be unmistakable."),
    ul([
      "**Your wallet's private keys.** They are created in your browser, encrypted there with a password only you know, and stored on your device. They never reach my server, not in a request, not in a log, not in a backup.",
      "**Your recovery phrase.** Same as above. Revealing it happens entirely in your browser.",
      "**Your wallet password.** It is used in your browser to unlock the keys for one signature and is then thrown away.",
      "**Your security question answers in readable form.** They are hashed before they are saved, so I cannot read them back.",
    ]),
    p(
      "A consequence of this is that I cannot recover any of these for you. If you lose your recovery phrase, I cannot restore your wallet, and I say so throughout the product because I would rather you hear it before you need it."
    ),

    h2("Where your wallet lives"),
    p(
      "In the browser you created it in. The encrypted keys are kept in that browser's local storage on that device. Clearing the browser's site data deletes them. That is why the product asks you, repeatedly, to write your recovery phrase down."
    ),

    h2("How I use what I collect"),
    ul([
      "To run the product: showing you your ledger, drafting and sending reminders, watching the blockchain for payments to your invoice addresses, watching prices for your alerts, and sending you the notifications you asked for.",
      "To write reminders in better words. When the writing assistant is switched on, the customer's name, the amount, the due date and the state of the debt are sent to Anthropic, the company whose model writes the paragraphs. Bank details and payment addresses are never sent to it; they are added afterwards, word for word.",
      "To reply to you when you write to me.",
      "To keep the service safe: limiting repeated attempts at signing in, and checking that a form was submitted by a person.",
    ]),
    p("I do not sell your data, I do not rent it, and I do not use it for advertising. I have no advertisers."),

    h2("Who else sees it"),
    p("I cannot run a product like this alone in a room, so a few companies do parts of the work. Each one sees only what its part needs."),
    ul([
      "**Hosting.** The application runs on Render and the website is served by Vercel. The database is hosted by MongoDB Atlas. Your data sits on their machines, encrypted in transit and at rest by them.",
      "**Prices and coin information** come from CoinGecko. It sees which coins are asked about, not who asked.",
      "**Blockchain reads and writes** go through node providers such as Alchemy and public nodes, and through mempool.space for Bitcoin. They see the addresses and transactions involved, which are public by nature. They do not see your keys, because nothing does.",
      "**Sign in with Google**, if you use it. Google sees that you signed into LedgerWatch.",
      "**Cloudflare Turnstile** checks that the sign in, sign up and contact forms were used by a person. It is built to do that without tracking you.",
      "**Email** is sent through an email provider, which sees the message and the address it goes to.",
      "**WhatsApp**, if automatic sending is set up, goes through the WhatsApp Cloud API or Twilio, which see the message and the number.",
      "**Push notifications** are delivered by the push service of your browser, which is Google, Apple or Mozilla. They see that a notification was sent to your device; the content is encrypted to your browser.",
      "**The writing assistant** is Anthropic, as described above.",
    ]),
    p(
      "Beyond those, I share data with nobody, unless the law in Nigeria requires me to, in which case I will share only what is required and tell you if I am allowed to."
    ),

    h2("The blockchain is public"),
    p(
      "Every transaction on every network, and every balance at every address, can be seen by anyone, forever. This is true of every wallet in the world and not something I can change. If you would rather a payment not be linked to you, do not make it on a public network."
    ),

    h2("Your customers' information"),
    p(
      "When you record a debt, you are giving me information about someone else: their name, their number, sometimes their email. You are responsible for having a proper reason to hold it, which for an invoice you issued you almost certainly do. I use it only to keep your ledger and to send the reminders you tell me to send, and I do not contact your customers for any other reason. If a customer asks you what LedgerWatch holds about them, the customer statement on their profile is a complete answer, and you can delete their debts at any time."
    ),

    h2("Cookies and storage"),
    p(
      "I do not use tracking cookies. The browser's local storage holds your session token, your theme choice, the encrypted wallet keys if you have a wallet, a cache of coin logos so they do not have to be fetched twice, and small conveniences like the last network you used. Signing out removes the session token. Removing the wallet from the device removes the keys. Clearing the site's data removes all of it, including the keys, so back up first."
    ),

    h2("How long I keep it"),
    ul([
      "Your account and everything in it, for as long as the account exists.",
      "**Clear all my data** in Settings deletes every debt, payment, reminder, watch, alert and trade at once and keeps only your login and profile.",
      "**Delete my account** deletes everything, including the account itself, right away.",
      "Messages sent through the Contact page, until I have dealt with them and for a reasonable time after in case you write back.",
      "Backups of the database exist so that a failure does not lose everyone's ledger. Deleted data leaves those backups as they expire, which takes a few weeks.",
    ]),

    h2("Security"),
    p(
      "Passwords are hashed. Traffic is encrypted. Sign in is protected by a human check and by limits on repeated attempts. The page refuses to run scripts from anywhere but its own address, so a stray script cannot read the sign in form. Changing your password signs out every other device. Sessions expire after seven days."
    ),
    p(
      "What I cannot promise is that nothing will ever go wrong. No one honestly can. What I can promise is that the thing that matters most, your wallet's keys, is not on my server to be stolen in the first place, and that if I ever learn of a breach affecting your data I will tell you as soon as I know."
    ),

    h2("Your rights"),
    p("Whatever the law where you live says, here is what you can do with me directly."),
    ul([
      "**See** what I hold. Nearly all of it is on screen in the product. Ask me for the rest.",
      "**Correct** it. Your profile, your payout details, your debts and your settings can all be edited.",
      "**Take a copy.** The ledger and each customer statement can be downloaded as a spreadsheet file.",
      "**Delete** it, in whole or in part, from Settings, without asking me.",
      "**Withdraw** notifications, automatic reminders or Google sign in at any time from Settings or your browser.",
      "**Complain**, to me first, and if I do not put it right, to the data protection authority in your country. In Nigeria that is the Nigeria Data Protection Commission.",
    ]),

    h2("Children"),
    p("LedgerWatch is a business tool that can move real money. It is not for anyone under eighteen, and I do not knowingly keep an account for anyone under eighteen. If you believe a child has made one, tell me and I will remove it."),

    h2("Changes to this policy"),
    p(
      "If I change how I handle your data, I will change this page and the date at the top, and if the change is significant I will tell you inside the product or by email before it takes effect. I will not quietly widen what I collect."
    ),

    h2("Contact"),
    p("Write to me through the [Contact page](/contact). Choose the topic that fits and I will reply to the email address you give."),
  ],
};

export const TERMS = {
  title: "Terms and conditions",
  meta: "Last updated 5 September 2026. Written by Eberechukwu Uchechukwu Gerald, who built and runs LedgerWatch.",
  blocks: [
    p(
      "These are the terms between you and me for using LedgerWatch. I have written them myself, in ordinary language, because I want you to actually read them. They matter more than most terms do, because this product can move real money, and some of what it does cannot be undone by anyone."
    ),

    h2("Who I am and what this is"),
    p(
      "LedgerWatch is made and run by me, Eberechukwu Uchechukwu Gerald, from Nigeria, at useledgerwatch.co. It is a tool for a business that sells on credit: it records what you are owed, reminds your customers, settles invoices paid in stablecoin, watches coin prices for you, and gives you a wallet that lives in your own browser."
    ),
    p(
      "It is a tool, not a bank. I do not hold your money, I do not hold your keys, I am not an exchange, a broker, a custodian or a financial adviser, and I am not licensed as any of those. Please keep that in mind throughout."
    ),

    h2("Agreeing to these terms"),
    p(
      "By creating an account or using the product you agree to these terms and to the [privacy policy](/privacy). If you do not agree, please do not use LedgerWatch. You must be at least eighteen and able to enter into an agreement where you live."
    ),

    h2("Your account"),
    ul([
      "Give me a real email address, because it is how you confirm your account, reset your password and hear from me.",
      "Keep your password to yourself and choose a good one. Everything done from your account is treated as done by you.",
      "One person, one account. Do not share an account or sign in as somebody else.",
      "Tell me quickly if you think somebody else has your password. Changing it signs every other device out.",
    ]),

    h2("Your wallet is yours, and so is the risk"),
    p("This is the part I most need you to understand."),
    ul([
      "The wallet's keys are created in your browser, encrypted with a password you choose, and kept on your device. I never receive them. That is the design, and it is what makes it impossible for me, or anyone who breaks into my server, to take your funds.",
      "The same design means I cannot recover your funds if you lose your recovery phrase and your device, cannot reset a wallet password, cannot reverse a transaction, and cannot freeze or move anything. Nobody can. Please write your recovery phrase down before you deposit anything.",
      "A transaction sent to the wrong address, with the wrong token, or on the wrong network is permanent. The product warns you at every step, names the network on every screen, and refuses the mistakes it can recognise, but it cannot catch all of them. Checking the address and the network before you sign is your job.",
      "Test networks exist so you can practise with worthless coins. Real networks use real money. The product tells you which you are on. If you choose to use a real network, the consequences are yours.",
      "Every transaction pays a network fee that goes to the network, not to me, and is not refundable, including for a transaction that fails.",
    ]),

    h2("Trading"),
    ul([
      "Paper trading is simulated. Nothing is bought or sold and no money moves.",
      "Live trading sends a real swap from your own wallet to Uniswap, a decentralised exchange I do not operate. The quote, the price impact, the slippage tolerance and the fee are shown to you before you sign, and nothing is sent until you enter your wallet password. Once sent, the outcome is up to the network and the market.",
      "Prices come from a third party and can be delayed or wrong. Alerts are raised from those prices. The agent's suggestion to buy, sell or hold is a rule applied to your own condition. It is not advice, it knows nothing about your circumstances, and it can be wrong. You decide, every time.",
      "The spending caps in the product exist to catch a mistyped amount. They are not a promise, they can be changed, and they do not protect you from a bad decision or a bad market.",
      "Coin prices can fall to nothing. Never trade with money you cannot afford to lose. Any loss from a trade you signed is yours.",
    ]),

    h2("Crypto payments on invoices"),
    ul([
      "Payment addresses are derived from your own wallet, so the money a customer sends goes to an address only you control. I never hold it.",
      "The stablecoin amount and the naira rate are locked when you create the address, and the invoice settles at that rate. Whether the rate later moves in your favour or against you is your risk, as it is with any invoice priced in another currency.",
      "A customer who sends the wrong token or uses the wrong network has lost that money, and neither you nor I can recover it. The address and every reminder carry a warning; passing it on to your customer is up to you.",
      "Settlement depends on my server watching the network. If it is down, a payment is detected when it comes back, not lost, but there can be delay.",
    ]),

    h2("Reminders and messages to your customers"),
    ul([
      "Everything sent to a customer is sent on your instruction and in your name. You are responsible for its content, for having a proper reason to contact that person, and for following the law where you and they are, including any rules about marketing messages and about data protection.",
      "Check your payout details. If a customer pays into the wrong account because the details you saved were wrong, that is not something I can fix.",
      "Delivery over WhatsApp and email depends on WhatsApp, on email providers and on the customer's own settings. A message can be delayed, land in spam or fail, and the product tells you what it knows.",
      "When the writing assistant is on, the wording is produced by a language model. Read a reminder before you send it.",
    ]),

    h2("What you agree not to do"),
    ul([
      "Use LedgerWatch for anything illegal, including moving money that is not yours to move, or laundering money.",
      "Harass or threaten anyone through it, or send reminders to people who owe you nothing.",
      "Attack it, probe it for weaknesses without telling me, overload it, scrape it, or try to get into anyone else's account.",
      "Pretend to be me or to be LedgerWatch.",
      "Copy the product and offer it as your own.",
    ]),
    p("If you find a security weakness, I would be grateful if you told me privately through the Contact page before telling anyone else."),

    h2("Fees"),
    p(
      "LedgerWatch is free to use at the moment. If I ever introduce a fee for any part of it, I will tell you clearly and in advance, and nothing you already have will be held to ransom for it. Network fees, exchange fees and the fees of any messaging provider are set by them, paid by you, and are not mine."
    ),

    h2("Availability and changes"),
    p(
      "I try to keep LedgerWatch running all the time, and I will tell you when I know it will be down. But I am one person relying on several other companies, and I cannot promise it will always be available, fast or free of faults. I may change, improve or remove features, and I will try to warn you when a change affects how you work. If I ever have to close the product, I will give you time to download your ledger, and your wallet will keep working from its recovery phrase in any standard wallet."
    ),

    h2("Other people's services"),
    p(
      "The product relies on CoinGecko, blockchain node providers, mempool.space, Uniswap, Google, Cloudflare, an email provider, and the WhatsApp providers you may configure. Each has its own terms and its own reliability. When one of them fails, the product says so where it can, but I cannot control them and I am not responsible for what they do."
    ),

    h2("Your data"),
    p(
      "How I handle it is in the [privacy policy](/privacy). In short: I keep only what the product needs, I never receive your keys, I do not sell anything, and you can delete everything yourself from Settings."
    ),

    h2("Ending things"),
    ul([
      "You can delete your account at any time from Settings. It is immediate.",
      "I can suspend or close an account that breaks these terms, or that I reasonably believe is being used to harm someone, and I will tell you why unless the law prevents me.",
      "Closing an account does not touch your wallet, which is in your browser, or your funds, which are on the network. Keep your recovery phrase and they remain yours.",
    ]),

    h2("What I am responsible for, and what I am not"),
    p(
      "LedgerWatch is provided as it is, without any promise that it is perfect or suits your particular purpose. I work hard to make it correct, especially anywhere money moves, and I write down what it does and does not do. But I am one person and it is software."
    ),
    p(
      "As far as the law allows, I am not liable for money lost through a transaction you signed, a lost recovery phrase or password, a wrong address, token or network, a market movement, a failure of a network or of any of the other companies I rely on, a delayed or undelivered message, or an interruption of the service. Where the law does not let me exclude liability, my total liability to you for everything arising from your use of LedgerWatch is limited to the amount you have paid me for it, which at present is nothing."
    ),
    p("Nothing here limits any liability that the law does not allow me to limit, including for fraud or for harm caused deliberately."),

    h2("If someone makes a claim because of what you did"),
    p(
      "If your use of LedgerWatch, or a message you sent through it, leads to a claim against me by somebody else, you agree to cover the costs and losses that come from it. I will tell you about the claim and not settle it in a way that binds you without talking to you first."
    ),

    h2("The law and disputes"),
    p(
      "These terms are governed by the laws of the Federal Republic of Nigeria, and any dispute is to be resolved in the courts of Nigeria, except where the law of your own country gives you protections that cannot be taken away. Before any of that, please write to me. Most problems are misunderstandings, and I would much rather fix one than argue about it."
    ),

    h2("Changes to these terms"),
    p(
      "I may update these terms. When I do, I will change the date at the top, and for any change that matters I will tell you inside the product or by email before it takes effect. Using LedgerWatch after that date means you accept the updated terms."
    ),

    h2("Contact"),
    p("Write to me through the [Contact page](/contact). I read every message myself."),
  ],
};
