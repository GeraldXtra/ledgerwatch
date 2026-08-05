const mongoose = require("mongoose");

// bankDetails is embedded on the user and used inside reminder messages.
const bankDetailsSchema = new mongoose.Schema(
  {
    accountName: { type: String },
    accountNumber: { type: String },
    bankName: { type: String },
  },
  { _id: false }
);

// Automatic reminder delivery — opt-in, default OFF. When enabled, the automation
// engine dispatches reminders through the configured channels instead of only
// generating them.
const autoSendSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: false },
    whatsapp: { type: Boolean, default: false },
    email: { type: Boolean, default: false },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  bankDetails: { type: bankDetailsSchema, default: {} },
  autoSend: { type: autoSendSchema, default: () => ({}) },
  // Public wallet address only — private keys never touch the server (Phase 4).
  walletAddress: { type: String, default: null },
  // Profile picture as a base64 data URL. Stored on the document so it needs no
  // external object storage and survives redeploys; the client square-crops and
  // resizes to ~512px first, and the server caps the DECODED size at 2MB.
  avatarUrl: { type: String, default: null },
  // Shown on reminders and statements alongside the payout details.
  companyName: { type: String, default: "" },
  // Per-category push opt-outs. Absent/true = send; explicit false = suppress.
  notifyPrefs: {
    marketAlerts: { type: Boolean, default: true },
    remindersDue: { type: Boolean, default: true },
    txUpdates: { type: Boolean, default: true },
  },

  // Crypto payment rails for invoices.
  crypto: {
    // Defaults ON. The flag previously defaulted to false and was enforced
    // nowhere, so the model claimed the feature was off while it worked
    // perfectly — a setting that describes nothing is worse than no setting.
    // Now that it is genuinely enforced, off by default would silently disable a
    // working feature on every existing account.
    enabled: { type: Boolean, default: true },
    // Stamped the first time these settings are normalised or saved. The boot
    // normalisation keys on this rather than on `enabled`, so a user who
    // deliberately turns the feature off is never overridden on the next start.
    configuredAt: { type: Date, default: null },
    // Per-chain confirmation depth, overriding the env/default table. Clamped on
    // write — a shallow depth is a real reorg risk, not just a preference.
    confirmationOverrides: { type: Map, of: Number, default: undefined },
    defaultChainId: { type: Number, default: 84532 }, // Base Sepolia
    expiryHours: { type: Number, default: 72 }, // max 720 (30 days)
    // Monotonic counter for the receivables derivation branch. ONLY ever moved
    // by an atomic $inc — never read-then-written — so two concurrent address
    // generations can never be handed the same index. A reused index would
    // break payment attribution irrecoverably.
    nextDerivationIndex: { type: Number, default: 0 },
    // Where swept funds go. Defaults to the user's own main wallet address.
    sweepDestination: { type: String, default: null },
    notifyOnDetected: { type: Boolean, default: true },
  },

  /**
   * Paper vs live trading. PAPER FOR EVERYONE BY DEFAULT — live mode spends real
   * (testnet) funds through a DEX, so it is opted into deliberately, never
   * arrived at by accident.
   */
  tradingMode: { type: String, enum: ["paper", "live"], default: "paper" },

  /**
   * ERC-20s the user added by contract address, per chain. `decimals` is stored
   * as READ FROM THE CONTRACT — never inferred from the symbol, because the same
   * symbol carries different decimals on different chains (USDC is 6 on most, 18
   * on BNB Chain) and getting it wrong misreads balances by 10^12.
   *
   * Stored server-side rather than in localStorage so the list survives a device
   * change, matching how the wallet address itself is handled.
   */
  customTokens: {
    type: [
      {
        _id: false,
        chainId: { type: Number, required: true },
        address: { type: String, required: true },
        symbol: { type: String, required: true },
        decimals: { type: Number, required: true },
      },
    ],
    default: [],
  },

  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("User", userSchema);