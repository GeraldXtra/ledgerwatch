const mongoose = require("mongoose");
const { scopedRepo } = require("../repositories/scoped");
const webhookRepo = require("../repositories/rampWebhook");
const ramp = require("../services/ramp.service");
const { notifyActivity } = require("../services/activity.service");

const STATUS_FOR_KIND = { invalid: 400, rejected: 502, unreachable: 503, upstream: 502 };
const TEXT_RE = /^[A-Za-z0-9 ._:+=\-/]{0,120}$/;

function clean(v) {
  const s = v == null ? null : String(v).trim().slice(0, 120);
  return s && TEXT_RE.test(s) ? s : null;
}

async function status(req, res) {
  try {
    return res.json(await ramp.rampStatusChecked());
  } catch (err) {
    console.error("ramp status error:", err.message);
    return res.json({ ...ramp.rampStatus(), keysAccepted: null, problem: `Whether Transak accepts this server could not be checked: ${err.message}` });
  }
}

async function session(req, res) {
  try {
    const mode = String(req.body.mode || "").toUpperCase();
    const cryptoCurrencyCode = req.body.cryptoCurrencyCode ? String(req.body.cryptoCurrencyCode).toUpperCase() : null;
    const out = await ramp.createSession({ user: req.user, mode, cryptoCurrencyCode, fiatAmount: req.body.fiatAmount });
    if (!out.ok) return res.status(STATUS_FOR_KIND[out.kind] || 502).json({ error: out.reason, kind: out.kind });
    await scopedRepo(req.user._id).rampOrders.create({
      partnerOrderId: out.partnerOrderId,
      mode: out.mode,
      cryptoCurrency: out.cryptoCurrencyCode,
      fiatAmount: out.fiatAmount != null ? String(out.fiatAmount) : null,
    });
    return res.status(201).json({ widgetUrl: out.widgetUrl, partnerOrderId: out.partnerOrderId, expiresInSeconds: 300 });
  } catch (err) {
    console.error("ramp session error:", err.message);
    return res.status(500).json({ error: "The payment page could not be opened" });
  }
}

async function orders(req, res) {
  const list = await scopedRepo(req.user._id).rampOrders.find({ outcome: { $ne: "started" } })
    .sort({ updatedAt: -1 })
    .limit(30)
    .select("-matchedBy -notifiedOutcome")
    .lean();
  return res.json({ orders: list });
}

async function ownerOf(data) {
  const ref = clean(data.partnerOrderId);
  if (ref) {
    const order = await webhookRepo.orderByPartnerId(ref);
    if (order && order.userId) return { userId: order.userId, matchedBy: "partnerOrderId", partnerOrderId: ref };
  }
  const customer = clean(data.partnerCustomerId);
  if (customer && (await webhookRepo.accountExists(customer))) {
    return { userId: new mongoose.Types.ObjectId(customer), matchedBy: "partnerCustomerId" };
  }
  const wallet = clean(data.walletAddress);
  if (wallet) {
    const evm = /^0x[0-9a-fA-F]{40}$/.test(wallet);
    const user = await webhookRepo.accountByWallet(wallet, evm);
    if (user) return { userId: user._id, matchedBy: "walletAddress" };
  }
  return { userId: null, matchedBy: null };
}

function announce(order) {
  const buying = order.mode === "BUY";
  const what = order.cryptoAmount && order.cryptoCurrency ? `${order.cryptoAmount} ${order.cryptoCurrency}` : order.cryptoCurrency || "crypto";
  const naira = order.fiatAmount ? `₦${Number(order.fiatAmount).toLocaleString("en-NG", { maximumFractionDigits: 2 })}` : null;
  const done = order.outcome === "completed";
  const hold = order.outcome === "on-hold";
  const title = done
    ? buying
      ? `Bought ${what}`
      : `Sold ${what}`
    : hold
      ? `Your ${buying ? "purchase" : "sale"} is on hold`
      : `Your ${buying ? "purchase" : "sale"} did not go through`;
  const body = done
    ? buying
      ? `${naira ? `${naira} paid. ` : ""}It has been sent to your wallet.`
      : `${naira ? `${naira} is on its way to your bank account.` : "The naira is on its way to your bank account."}`
    : hold
      ? "The provider has paused this order and will contact you."
      : `Status: ${order.status}. ${buying ? "If you were charged, the provider refunds it." : "If your crypto was sent, the provider returns it."}`;
  return notifyActivity(order.userId, {
    category: done ? (buying ? "moneyIn" : "trades") : "txUpdates",
    tag: `ramp-${order._id}`,
    url: "/app/wallet",
    symbol: order.cryptoCurrency,
    title,
    body,
    email: {
      subject: title,
      intro: body,
      tone: done ? "pos" : hold ? "info" : "neg",
      hero: { label: buying ? "Purchase" : "Sale", value: what, sub: naira || undefined },
      rows: [
        { label: "Status", value: order.status },
        { label: "Network", value: order.network || undefined },
        { label: "Wallet", value: order.walletAddress || undefined, mono: true },
        { label: "Transaction", value: order.txHash || undefined, mono: true },
        { label: "Provider order", value: order.providerOrderId || undefined, mono: true },
      ],
    },
  });
}

async function webhook(req, res) {
  try {
    const claims = await ramp.verifyWebhookFresh(req.body.data);
    if (!claims) {
      console.warn(`[ramp] refused a webhook that did not verify, from ${req.ip}`);
      return res.status(401).json({ error: "Signature not valid" });
    }
    const data = claims.webhookData || {};
    const providerOrderId = clean(data.id);
    if (!providerOrderId) return res.status(400).json({ error: "No order id" });
    const statusText = clean(data.status) || "UNKNOWN";
    const outcome = ramp.outcomeOf(statusText);
    const owner = await ownerOf(data);
    const mode = String(data.isBuyOrSell || "").toUpperCase() === "SELL" ? "SELL" : "BUY";

    const set = {
      provider: "transak",
      providerOrderId,
      mode,
      status: statusText,
      outcome,
      cryptoCurrency: clean(data.cryptoCurrency || data.cryptocurrency),
      cryptoAmount: clean(data.cryptoAmount),
      fiatCurrency: clean(data.fiatCurrency) || "NGN",
      fiatAmount: clean(data.fiatAmount),
      network: clean(data.network),
      walletAddress: clean(data.walletAddress),
      txHash: clean(data.transactionHash),
      lastEvent: clean(claims.eventID),
      updatedAt: new Date(),
    };
    if (owner.userId) {
      set.userId = owner.userId;
      set.matchedBy = owner.matchedBy;
    }

    let order = owner.partnerOrderId
      ? await webhookRepo.updateByPartnerId(owner.partnerOrderId, set)
      : null;
    if (!order) {
      order = await webhookRepo.upsertByProviderId(providerOrderId, set);
    }

    if (!order.userId) {
      console.warn(`[ramp] order ${providerOrderId} (${statusText}) matched no account; stored without a notice`);
      return res.json({ ok: true, matched: false });
    }
    if (["completed", "failed", "on-hold"].includes(outcome)) {
      const claimed = await webhookRepo.claimNotice(order._id, outcome);
      if (claimed) announce(claimed).catch((err) => console.error("[ramp] notice failed:", err.message));
    }
    return res.json({ ok: true, matched: true });
  } catch (err) {
    console.error("ramp webhook error:", err.message);
    return res.status(500).json({ error: "Webhook failed" });
  }
}

module.exports = { status, session, orders, webhook };
