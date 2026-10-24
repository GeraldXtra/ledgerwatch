const User = require("../models/User");
const { getChain } = require("../config/chains");
const { confirmationsFor: baseConfirmationsFor } = require("../config/derivation");

const MIN_CONFIRMATIONS = 1;
const MAX_CONFIRMATIONS = 300;
const MIN_EXPIRY_HOURS = 1;
const MAX_EXPIRY_HOURS = 720;

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

async function normalizeCryptoSettings() {
  try {
    const res = await User.updateMany(
      { "crypto.configuredAt": null },
      { $set: { "crypto.enabled": true, "crypto.configuredAt": new Date() } }
    );
    if (res.modifiedCount) {
      console.log(`Crypto settings: enabled on ${res.modifiedCount} existing account(s)`);
    }
    return res.modifiedCount || 0;
  } catch (err) {
    console.error("Crypto settings normalisation failed:", err.message);
    return 0;
  }
}

function cryptoEnabled(user) {
  return !user || !user.crypto || user.crypto.enabled !== false;
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function requireCryptoEnabled(user) {
  if (!cryptoEnabled(user)) {
    throw httpError(403, "Crypto payments are switched off for this account. Turn them on in Settings.");
  }
}

function confirmationsFor(chainId, user) {
  const overrides = user && user.crypto && user.crypto.confirmationOverrides;
  if (overrides) {
    const raw = typeof overrides.get === "function" ? overrides.get(String(chainId)) : overrides[String(chainId)];
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) {
      return Math.min(MAX_CONFIRMATIONS, Math.max(MIN_CONFIRMATIONS, Math.round(n)));
    }
  }
  return baseConfirmationsFor(chainId);
}

function buildCryptoUpdate(patch) {
  const updates = {};
  if (typeof patch.enabled === "boolean") updates["crypto.enabled"] = patch.enabled;
  if (typeof patch.notifyOnDetected === "boolean") {
    updates["crypto.notifyOnDetected"] = patch.notifyOnDetected;
  }

  if (patch.defaultChainId !== undefined) {
    const chainId = Number(patch.defaultChainId);
    if (!getChain(chainId)) {
      throw httpError(400, "That network is not available. Pick one of the enabled networks.");
    }
    updates["crypto.defaultChainId"] = chainId;
  }

  if (patch.expiryHours !== undefined) {
    const hours = Number(patch.expiryHours);
    if (!Number.isFinite(hours)) throw httpError(400, "Expiry must be a number of hours");
    updates["crypto.expiryHours"] = Math.min(
      MAX_EXPIRY_HOURS,
      Math.max(MIN_EXPIRY_HOURS, Math.round(hours))
    );
  }

  if (patch.sweepDestination !== undefined) {
    const dest = patch.sweepDestination;
    if (dest === null || dest === "") {
      updates["crypto.sweepDestination"] = null;
    } else if (ADDRESS_RE.test(String(dest))) {
      updates["crypto.sweepDestination"] = String(dest);
    } else {
      throw httpError(400, "The sweep destination must be a valid address, or empty to use your own wallet.");
    }
  }

  if (patch.confirmationOverrides !== undefined) {
    const src = patch.confirmationOverrides || {};
    const clean = {};
    for (const [chainId, value] of Object.entries(src)) {
      if (!getChain(Number(chainId))) continue;
      const n = Number(value);
      if (!Number.isFinite(n)) continue;
      clean[String(chainId)] = Math.min(
        MAX_CONFIRMATIONS,
        Math.max(MIN_CONFIRMATIONS, Math.round(n))
      );
    }
    updates["crypto.confirmationOverrides"] = clean;
  }

  if (Object.keys(updates).length) updates["crypto.configuredAt"] = new Date();
  return updates;
}

module.exports = {
  normalizeCryptoSettings,
  cryptoEnabled,
  requireCryptoEnabled,
  confirmationsFor,
  buildCryptoUpdate,
  MIN_CONFIRMATIONS,
  MAX_CONFIRMATIONS,
  MIN_EXPIRY_HOURS,
  MAX_EXPIRY_HOURS,
};
