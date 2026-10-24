const RECEIVABLES_BRANCH = "m/44'/60'/0'/2";

function pathForIndex(index) {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`Invalid derivation index: ${index}`);
  }
  return `${RECEIVABLES_BRANCH}/${index}`;
}

const BLOCK_TIME_SEC = {
  11155111: 12,
  84532: 2,
  421614: 0.25,
  11155420: 2,
  80002: 2,
  1: 12.04,
  8453: 2.0,
  10: 2.0,
  42161: 0.25,
  137: 1.5,
  56: 0.45,
  43114: 1.05,
};

function blockTimeFor(chainId) {
  const t = BLOCK_TIME_SEC[Number(chainId)];
  return Number.isFinite(t) && t > 0 ? t : 2;
}

const DEFAULT_CONFIRMATIONS = {
  11155111: 12,
  84532: 5,
  421614: 5,
  11155420: 5,
  80002: 5,

  1: 12,
  8453: 30,
  10: 30,
  42161: 240,
  137: 135,
  56: 135,
  43114: 60,
};

const MIN_ENV_CONFIRMATIONS = 1;
const MAX_ENV_CONFIRMATIONS = 300;
const warnedConfirmations = new Set();

function confirmationsFor(chainId) {
  const fallback = DEFAULT_CONFIRMATIONS[Number(chainId)] || 12;
  const raw = process.env[`CONFIRMATIONS_${chainId}`];
  if (raw === undefined || String(raw).trim() === "") return fallback;

  const n = Number(raw);
  if (!Number.isFinite(n) || n < MIN_ENV_CONFIRMATIONS || n > MAX_ENV_CONFIRMATIONS) {
    if (!warnedConfirmations.has(String(chainId))) {
      warnedConfirmations.add(String(chainId));
      console.error(
        `CONFIRMATIONS_${chainId} is "${raw}", which is not a depth between ` +
          `${MIN_ENV_CONFIRMATIONS} and ${MAX_ENV_CONFIRMATIONS}. Ignoring it and using the ` +
          `measured default of ${fallback} blocks. Settling an invoice at zero confirmations ` +
          `would credit money a reorg can still remove.`
      );
    }
    return fallback;
  }
  return Math.round(n);
}

function positiveEnvNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    console.error(
      `${name} is "${raw}", which is not a positive number. Using ${fallback} instead. ` +
        `Left as it was, this would have disabled the guard it configures rather than tightening it.`
    );
    return fallback;
  }
  return n;
}

const GRACE_DAYS = positiveEnvNumber("PAYMENT_GRACE_DAYS", 30);

const GRACE_SCAN_MINUTES = positiveEnvNumber("PAYMENT_GRACE_SCAN_MINUTES", 60);

const MAX_ADDRESSES_PER_HOUR = positiveEnvNumber("MAX_PAYMENT_ADDRESSES_PER_HOUR", 20);

module.exports = {
  RECEIVABLES_BRANCH,
  pathForIndex,
  blockTimeFor,
  confirmationsFor,
  DEFAULT_CONFIRMATIONS,
  GRACE_DAYS,
  GRACE_SCAN_MINUTES,
  MAX_ADDRESSES_PER_HOUR,
};
