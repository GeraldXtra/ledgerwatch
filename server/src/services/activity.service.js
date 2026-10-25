const User = require("../models/User");
const { notifyUser } = require("./push.service");
const { renderActivityEmail, activityText, appUrl } = require("../utils/emailBrand");

const SYMBOL_TO_COIN = {
  BTC: "bitcoin",
  WBTC: "bitcoin",
  CBBTC: "bitcoin",
  BTCB: "bitcoin",
  ETH: "ethereum",
  WETH: "ethereum",
  USDC: "usd-coin",
  USDT: "tether",
  "USD₮0": "tether",
  USDT0: "tether",
  BNB: "binancecoin",
  WBNB: "binancecoin",
  POL: "matic-network",
  WPOL: "matic-network",
  AVAX: "avalanche-2",
  WAVAX: "avalanche-2",
  SOL: "solana",
  TRX: "tron",
  TON: "the-open-network",
  LTC: "litecoin",
  DOGE: "dogecoin",
  LINK: "chainlink",
  UNI: "uniswap",
  ARB: "arbitrum",
  OP: "optimism",
  AAVE: "aave",
};

async function iconFor({ symbol, coinId }) {
  const id = coinId || SYMBOL_TO_COIN[String(symbol || "").trim().toUpperCase()];
  if (!id) return null;
  try {
    const { getStoredLogos } = require("./coingecko.service");
    const logos = await getStoredLogos([id]);
    return logos[id] || null;
  } catch {
    return null;
  }
}

async function emailActivity(userId, category, content) {
  const user = await User.findById(userId).select("email emailVerified notifyPrefs").lean();
  if (!user || !user.email) return { sent: false, reason: "no-email" };
  if (!user.emailVerified) return { sent: false, reason: "unverified" };
  const prefs = user.notifyPrefs || {};
  if (prefs.emailActivity === false) return { sent: false, reason: "off" };
  if (category && prefs[category] === false) return { sent: false, reason: "category-off" };

  const { sendEmail, getLogoAttachment } = require("./notify.service");
  const unsubscribe = require("./unsubscribe.service").unsubscribeLinks({ kind: "owner", userId });
  const logo = getLogoAttachment();
  const html = renderActivityEmail({
    hasLogo: Boolean(logo),
    subtitle: "Account activity",
    ...content,
    unsubscribeUrl: unsubscribe.page,
  });
  const text = activityText({ ...content, unsubscribeUrl: unsubscribe.page });
  const res = await sendEmail(user.email, content.subject || content.title, html, {
    text,
    attachments: logo ? [logo] : [],
    category: "activity",
    unsubscribe,
  });
  return { sent: Boolean(res && res.ok), reason: res && res.reason };
}

async function notifyActivity(userId, event) {
  const { category, title, body, url = "/app", tag, symbol, coinId, email } = event;
  const icon = event.icon || (await iconFor({ symbol, coinId }));

  const push = await notifyUser(
    userId,
    { title, body, url, tag, type: category || "info", icon: icon || undefined },
    category,
    { urgency: event.urgency || "high" }
  ).catch((err) => {
    console.error(`[activity] push failed for ${userId}:`, err.message);
    return { sent: 0, error: err.message };
  });

  let mail = null;
  if (email) {
    mail = await emailActivity(userId, category, {
      title,
      ...email,
      cta: email.cta || { label: "Open LedgerWatch", url: appUrl(url) },
    }).catch((err) => {
      console.error(`[activity] email failed for ${userId}:`, err.message);
      return { sent: false, reason: "error" };
    });
  }

  return { push, email: mail };
}

module.exports = { notifyActivity, emailActivity, iconFor, SYMBOL_TO_COIN };
