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
    createdAt: u.createdAt,
  };
}

module.exports = publicUser;
