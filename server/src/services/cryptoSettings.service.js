const User = require("../models/User");
const { getChain } = require("../config/chains");
const { confirmationsFor: baseConfirmationsFor } = require("../config/derivation");

/**
 * Crypto payment settings: reading them, validating writes, and enforcing them.
 *
 * `crypto.enabled` and `crypto.notifyOnDetected` existed on the model for a long
 * time and were read by NOTHING. A setting that gates nothing is worse than no
 * setting at all, because it tells the reader something untrue about the system.
 */

// A confirmation depth below this is not a preference, it is a way to lose money
// to a reorg. Above 200 the address would effectively never settle.
const MIN_CONFIRMATIONS = 1;
const MAX_CONFIRMATIONS = 200;
const MIN_EXPIRY_HOURS = 1;
const MAX_EXPIRY_HOURS = 720; // 30 days

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * Bring existing accounts onto the new default exactly once.
 *
 * Keyed on `configuredAt` rather than on the value of `enabled`, so this can run
 * on every boot and is a no-op after the first: once a user has saved their
 * settings, a deliberate `enabled: false` is theirs and is never overwritten.
 * Safe to apply now because no UI has ever written this field, so every stored
 * `false` is a leftover default rather than a choice anyone made.
 */
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
    // Never stop the server booting over a settings migration.
    console.error("Crypto settings normalisation failed:", err.message);
    return 0;
  }
}

/** Is the crypto payments feature on for this user? Absent config reads as on. */
function cryptoEnabled(user) {
  return !user || !user.crypto || user.crypto.enabled !== false;
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/** Throw a 403 unless the feature is on. Used by the issue endpoints. */
function requireCryptoEnabled(user) {
  if (!cryptoEnabled(user)) {
    throw httpError(403, "Crypto payments are switched off for this account. Turn them on in Settings.");
  }
}

/**
 * Confirmation depth for a chain, honouring a per-user override.
 *
 * Falls back to the env/default table, and CLAMPS: the UI lets someone lower
 * this, and a depth of zero would settle an invoice on a transaction that has
 * not been included in a block anyone agrees on.
 */
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

/**
 * Validate and normalise a `crypto` settings patch from the client. Returns the
 * fields to $set, or throws a 400 naming what was wrong.
 */
function buildCryptoUpdate(patch) {
  const updates = {};
  if (typeof patch.enabled === "boolean") updates["crypto.enabled"] = patch.enabled;
  if (typeof patch.notifyOnDetected === "boolean") {
    updates["crypto.notifyOnDetected"] = patch.notifyOnDetected;
  }

  if (patch.defaultChainId !== undefined) {
    const chainId = Number(patch.defaultChainId);
    if (!getChain(chainId)) {
      throw httpError(400, "That network is not available. Pick one of the enabled testnets.");
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
      // Swept funds go here. A typo would send collected money somewhere
      // unrecoverable, so this is rejected rather than coerced.
      throw httpError(400, "The sweep destination must be a valid address, or empty to use your own wallet.");
    }
  }

  if (patch.confirmationOverrides !== undefined) {
    const src = patch.confirmationOverrides || {};
    const clean = {};
    for (const [chainId, value] of Object.entries(src)) {
      if (!getChain(Number(chainId))) continue; // ignore unknown chains silently
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
