const { notifyPrefsOf } = require("./notifyPrefs");

function publicUser(user) {
  if (!user) return null;
  const u = typeof user.toObject === "function" ? user.toObject() : user;
  return {
    _id: u._id,
    name: u.name,
    email: u.email,
    bankDetails: u.bankDetails || {},
    autoSend: u.autoSend || { enabled: false, whatsapp: false, email: false },
    walletAddress: u.walletAddress || null,
    avatarUrl: u.avatarUrl || null,
    companyName: u.companyName || "",
    notifyPrefs: notifyPrefsOf(u.notifyPrefs),
    crypto: cryptoSettings(u.crypto),
    tradingLimits: u.tradingLimits || {},
    authProvider: u.authProvider === "google" ? "google" : "password",
    tradingMode: u.tradingMode || "paper",
    customTokens: u.customTokens || [],
    twoFactorEnabled: Boolean(u.twoFactor && u.twoFactor.enabled),
    pendingEmail: pendingEmailOf(u.emailChange),
    createdAt: u.createdAt,
  };
}

function pendingEmailOf(change) {
  if (!change || !change.newEmail || !change.expiresAt) return null;
  return new Date(change.expiresAt).getTime() > Date.now() ? change.newEmail : null;
}

function cryptoSettings(crypto) {
  const c = crypto || {};
  const overrides = c.confirmationOverrides;
  return {
    enabled: c.enabled !== false,
    defaultChainId: c.defaultChainId || (process.env.ENABLE_MAINNET === "true" ? 8453 : 84532),
    expiryHours: c.expiryHours || 72,
    sweepDestination: c.sweepDestination || null,
    notifyOnDetected: c.notifyOnDetected !== false,
    confirmationOverrides:
      overrides && typeof overrides.entries === "function"
        ? Object.fromEntries(overrides)
        : overrides || {},
  };
}

module.exports = publicUser;
