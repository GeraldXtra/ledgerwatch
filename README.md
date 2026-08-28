# LedgerWatch

### The problem

Every business that sells on credit runs into the same thing. The work is finished, the invoice goes
out, and then somebody has to remember to follow it up. Nobody enjoys that conversation, so it gets
postponed, and postponed quietly becomes forgotten. Money that was already earned just sits there,
not because the client refused to pay, but because nobody chased it.

I built LedgerWatch because that gap is a software problem rather than a discipline problem.

### What it does

Two agents share one dashboard.

**Receivables** keeps track of who owes you and when it was due. It drafts the reminder, sends it
over WhatsApp or email with your bank details already in it, and stops chasing the moment an invoice
is settled. Over time it also builds a picture of who actually pays on schedule, which turns out to
be the useful thing to know the next time somebody asks you for credit.

It can also issue a crypto payment address that belongs to one invoice and nothing else. That sounds
like a payments feature but it is really an accounting one. Because the address is unique, money
arriving there is proof of who paid. There is no reference number to quote and nothing to match up
by hand. The app watches the blockchain and closes the invoice by itself once the payment confirms.

**Market Watch** keeps an eye on coin prices against conditions you set in ordinary language. When
something moves, it tells you what happened, explains why it thinks you should care, and suggests
what it would do. Then it stops and waits. Nothing executes until a person approves it.

Both sit on a wallet where the keys never leave your browser. They are created there, encrypted
there, and every transaction is signed with a password you type at that moment. The server only ever
learns your public address.

### Where it stands

This runs on test networks. The money handling works end to end and none of it touches real funds,
which is deliberate. Putting key handling in front of the public before it has been properly reviewed
would be irresponsible, so I have not done it.

The rule I kept coming back to while building it: the agent prepares, the person approves. It is
fully automatic in how it thinks and deliberately manual where it matters. When software touches
money, the last decision should belong to a human being.

### Built with

Node, Express and MongoDB on the server. React and Vite on the client, with ethers for the
blockchain work. Claude handles the writing and the conversation, and every one of those paths has a
plain template behind it so the app carries on working when the AI is unavailable.

### License

Copyright 2026 Eberechukwu Uchechukwu Gerald. All rights reserved.

The source is public so that it can be read and assessed. It is not open source. No permission is
granted to copy, modify, distribute or reuse it. See LICENSE for the full terms.

### Author

**Eberechukwu Uchechukwu Gerald**
ADSE in Artificial Intelligence and Machine Learning, Aptech
