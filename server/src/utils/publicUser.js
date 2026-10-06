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
    notifyPrefs: u.notifyPrefs || { marketAlerts: true, remindersDue: true, txUpdates: true },
    crypto: cryptoSettings(u.crypto),
    authProvider: u.authProvider === "google" ? "google" : "password",
    tradingMode: u.tradingMode || "paper",
    customTokens: u.customTokens || [],
    createdAt: u.createdAt,
  };
}

function cryptoSettings(crypto) {
  const c = crypto || {};
  const overrides = c.confirmationOverrides;
  return {
    enabled: c.enabled !== false,
    defaultChainId: c.defaultChainId || 84532,
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
