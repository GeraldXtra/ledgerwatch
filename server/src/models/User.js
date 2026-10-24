const mongoose = require("mongoose");

const bankDetailsSchema = new mongoose.Schema(
  {
    accountName: { type: String },
    accountNumber: { type: String },
    bankName: { type: String },
  },
  { _id: false }
);

const autoSendSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: false },
    whatsapp: { type: Boolean, default: false },
    email: { type: Boolean, default: false },
  },
  { _id: false }
);

const emailVerificationSchema = new mongoose.Schema(
  {
    codeHash: { type: String, default: null },
    expiresAt: { type: Date, default: null },
    attempts: { type: Number, default: 0 },
    lastSentAt: { type: Date, default: null },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  emailVerified: { type: Boolean, default: false },
  emailVerification: { type: emailVerificationSchema, default: () => ({}) },
  passwordReset: { type: emailVerificationSchema, default: () => ({}) },
  googleId: { type: String, default: null, index: true, sparse: true },
  authProvider: { type: String, enum: ["password", "google"], default: "password" },
  tokenVersion: { type: Number, default: 0 },
  bankDetails: { type: bankDetailsSchema, default: {} },
  autoSend: { type: autoSendSchema, default: () => ({}) },
  walletAddress: { type: String, default: null },
  profitAddress: { type: String, default: null },
  chainAddresses: {
    type: [
      new mongoose.Schema(
        {
          chain: { type: String, required: true },
          network: { type: String, required: true },
          address: { type: String, required: true },
          addedAt: { type: Date, default: Date.now },
          lastBalance: { type: String, default: null },
          lastCheckedAt: { type: Date, default: null },
        },
        { _id: false }
      ),
    ],
    default: [],
  },
  avatarUrl: { type: String, default: null },
  companyName: { type: String, default: "" },
  notifyPrefs: {
    marketAlerts: { type: Boolean, default: true },
    remindersDue: { type: Boolean, default: true },
    txUpdates: { type: Boolean, default: true },
    moneyIn: { type: Boolean, default: true },
    trades: { type: Boolean, default: true },
    profit: { type: Boolean, default: true },
    emailActivity: { type: Boolean, default: true },
  },

  crypto: {
    enabled: { type: Boolean, default: true },
    configuredAt: { type: Date, default: null },
    confirmationOverrides: { type: Map, of: Number, default: undefined },
    defaultChainId: { type: Number, default: () => (process.env.ENABLE_MAINNET === "true" ? 8453 : 84532) },
    expiryHours: { type: Number, default: 72 },
    nextDerivationIndex: { type: Number, default: 0 },
    sweepDestination: { type: String, default: null },
    notifyOnDetected: { type: Boolean, default: true },
  },

  tradingMode: { type: String, enum: ["paper", "live"], default: "paper" },

  tradingLimits: {
    perTrade: { type: Number, default: null },
    perDay: { type: Number, default: null },
    perSession: { type: Number, default: null },
    minNativeFloor: { type: Number, default: null },
    maxPriceImpactPct: { type: Number, default: null },
  },

  walletHistoryCursors: {
    type: [{ _id: false, chainId: { type: Number, required: true }, block: { type: Number, required: true } }],
    default: [],
  },

  walletSecurity: {
    enabled: { type: Boolean, default: false },
    questions: {
      type: [
        {
          _id: false,
          id: { type: String, required: true },
          prompt: { type: String, required: true },
          answerHash: { type: String, required: true },
        },
      ],
      default: [],
    },
    failedAttempts: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
  },

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

  discoveredTokens: {
    type: [
      {
        _id: false,
        chainId: { type: Number, required: true },
        address: { type: String, required: true },
        symbol: { type: String, default: null },
        name: { type: String, default: null },
        decimals: { type: Number, default: null },
        readable: { type: Boolean, default: false },
        lookupAttempts: { type: Number, default: 0 },
        lastLookupAt: { type: Date, default: null },
        impersonates: { type: String, default: null },
        firstSeenAt: { type: Date, default: Date.now },
        firstSeenBlock: { type: Number, default: null },
        firstTxHash: { type: String, default: null },
        firstFrom: { type: String, default: null },
        firstAmount: { type: String, default: null },
        status: { type: String, enum: ["new", "added", "ignored"], default: "new" },
        decidedAt: { type: Date, default: null },
      },
    ],
    default: [],
  },

  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("User", userSchema);