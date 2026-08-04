/**
 * Shape a User doc for API responses — every field EXCEPT passwordHash.
 * Used by all auth endpoints so the returned user object is identically shaped.
 * Accepts a Mongoose doc or a plain object.
 */
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
    createdAt: u.createdAt,
  };
}

/**
 * The settable crypto fields only.
 *
 * `nextDerivationIndex` is deliberately withheld: it is an internal monotonic
 * counter, not a preference, and nothing in the UI should be able to read it and
 * start reasoning about it.
 */
function cryptoSettings(crypto) {
  const c = crypto || {};
  const overrides = c.confirmationOverrides;
  return {
    enabled: c.enabled !== false,
    defaultChainId: c.defaultChainId || 84532,
    expiryHours: c.expiryHours || 72,
    sweepDestination: c.sweepDestination || null,
    notifyOnDetected: c.notifyOnDetected !== false,
    // Mongoose Maps do not survive JSON.stringify as plain objects.
    confirmationOverrides:
      overrides && typeof overrides.entries === "function"
        ? Object.fromEntries(overrides)
        : overrides || {},
  };
}

module.exports = publicUser;
