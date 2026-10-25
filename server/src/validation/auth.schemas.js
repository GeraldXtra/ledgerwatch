const { z, text, numberish, integerish, emptyOr, chainId } = require("./fields");
const { NOTIFY_PREF_KEYS } = require("../utils/notifyPrefs");

const email = text(254);
const password = text(256);
const turnstileToken = text(4096).nullable().optional();
const code = text(20);

const bankDetails = z.object({
  bankName: text(120).optional(),
  accountName: text(120).optional(),
  accountNumber: text(120).optional(),
});

const notifyPrefs = z.object(Object.fromEntries(NOTIFY_PREF_KEYS.map((key) => [key, z.boolean().optional()])));

const autoSend = z.object({
  enabled: z.boolean().optional(),
  whatsapp: z.boolean().optional(),
  email: z.boolean().optional(),
});

const crypto = z.object({
  enabled: z.boolean().optional(),
  notifyOnDetected: z.boolean().optional(),
  defaultChainId: emptyOr(chainId).nullable().optional(),
  expiryHours: numberish.optional(),
  sweepDestination: text(100).nullable().optional(),
  confirmationOverrides: z.record(z.string().regex(/^\d{1,12}$/, "That is not a network id."), integerish).optional(),
});

module.exports = {
  register: {
    body: z.object({
      name: text(200).optional(),
      email: email.optional(),
      password: password.optional(),
      bankDetails: bankDetails.optional(),
      turnstileToken,
    }),
  },
  login: { body: z.object({ email: email.optional(), password: password.optional(), turnstileToken }) },
  verifyEmail: { body: z.object({ email: email.optional(), code: code.optional() }) },
  emailOnly: { body: z.object({ email: email.optional() }) },
  forgotPassword: { body: z.object({ email: email.optional(), turnstileToken }) },
  resetPassword: {
    body: z.object({ email: email.optional(), code: code.optional(), newPassword: password.optional() }),
  },
  googleStart: { query: z.object({ n: text(200).optional() }) },
  googleCallback: {
    query: z.object({
      code: text(2048).optional(),
      state: text(4096).optional(),
      error: text(500).optional(),
      error_description: text(2000).optional(),
      scope: text(2000).optional(),
      authuser: text(20).optional(),
      prompt: text(100).optional(),
      hd: text(255).optional(),
      iss: text(255).optional(),
    }),
  },
  none: {},
  updateMe: {
    body: z.object({
      name: text(200).optional(),
      companyName: text(200).optional(),
      bankDetails: bankDetails.optional(),
      autoSend: autoSend.optional(),
      notifyPrefs: notifyPrefs.optional(),
      crypto: crypto.optional(),
    }),
  },
  avatar: { body: z.object({ dataUrl: text(3 * 1024 * 1024).optional() }) },
  changePassword: { body: z.object({ currentPassword: password.optional(), newPassword: password.optional() }) },
  loginSecondFactor: { body: z.object({ challenge: text(2000).optional(), code: text(40).optional() }) },
  passwordOnly: { body: z.object({ password: password.optional() }) },
  codeOnly: { body: z.object({ code: text(40).optional() }) },
  passwordAndCode: { body: z.object({ password: password.optional(), code: text(40).optional() }) },
  emailChangeStart: { body: z.object({ newEmail: email.optional(), password: password.optional(), code: text(40).optional() }) },
};
