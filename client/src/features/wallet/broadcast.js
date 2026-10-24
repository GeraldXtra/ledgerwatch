import { Transaction, isError } from "ethers";
import { recordTx, updateTxStatus } from "./walletApi";

const ALREADY_KNOWN =
  /already known|known transaction|already imported|alreadyknown|already in (the )?(tx ?)?pool|already exists/i;

const REFUSED =
  /insufficient funds|nonce too (low|high)|nonce has already been used|underpriced|intrinsic gas too low|exceeds block gas limit|gas limit reached|block base fee|fee cap|max fee per gas|max priority fee|tip (is )?higher than|exceeds the configured cap|invalid sender|invalid signature|invalid chain ?id|only replay-protected|oversized data|transaction size|txpool is full|transaction pool is full|rlp/i;

const REFUSED_CODES = new Set(["INSUFFICIENT_FUNDS", "NONCE_EXPIRED", "REPLACEMENT_UNDERPRICED"]);

function nodeError(err) {
  if (!err || err.code === "SERVER_ERROR") return null;
  const e = (err.info && err.info.error) || err.error;
  return e && typeof e.message === "string" ? e : null;
}

function proxyAnswer(err) {
  const raw = err && err.info && err.info.responseBody;
  if (typeof raw !== "string" || !raw.trim().startsWith("{")) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function httpStatus(err) {
  const fromInfo = err && err.info && err.info.responseStatus;
  const n = Number(String(fromInfo || "").slice(0, 3));
  if (Number.isInteger(n) && n > 0) return n;
  const fromResponse = err && err.response && err.response.statusCode;
  return Number.isInteger(fromResponse) ? fromResponse : 0;
}

export function classifyBroadcastError(err) {
  const rpc = nodeError(err);
  if (rpc) {
    if (ALREADY_KNOWN.test(rpc.message)) return { outcome: "accepted", reason: rpc.message };
    if (REFUSED_CODES.has(err.code) || REFUSED.test(rpc.message)) {
      return { outcome: "refused", reason: rpc.message };
    }
    return { outcome: "unknown", reason: rpc.message };
  }

  if (err && err.code === "SERVER_ERROR") {
    const status = httpStatus(err);
    const body = proxyAnswer(err);
    const said = (body && (body.reason || body.error)) || `HTTP ${status || "error"}`;
    if (body && body.broadcast === "not_sent") return { outcome: "refused", reason: said };
    if (status >= 400 && status < 500) return { outcome: "refused", reason: said };
    return { outcome: "unknown", reason: said };
  }

  return {
    outcome: "unknown",
    reason: (err && (err.shortMessage || err.message)) || "the network did not answer",
  };
}

export async function signForBroadcast(signer, request) {
  const populated = await signer.populateTransaction(request);
  delete populated.from;
  const signed = await signer.signTransaction(Transaction.from(populated));
  return { signed, hash: Transaction.from(signed).hash };
}

export async function broadcastSigned(provider, signed) {
  try {
    const response = await provider.broadcastTransaction(signed);
    return { outcome: "accepted", response, reason: null };
  } catch (err) {
    return classifyBroadcastError(err);
  }
}

function apiError(err) {
  return (err && err.response && err.response.data && err.response.data.error) || (err && err.message) || "";
}

export async function sendRecorded({ signer, provider, request, record, label }) {
  const { signed, hash } = await signForBroadcast(signer, request);
  let row = null;
  let why = "";
  try {
    row = await recordTx({ ...record, hash });
  } catch (err) {
    why = apiError(err);
  }
  if (!row || !row._id) {
    throw new Error(
      `This ${label} was signed but not sent, because it could not be saved to your history first. ` +
        `Nothing was sent. Try again in a moment.${why ? ` (${why})` : ""}`
    );
  }
  const sent = await broadcastSigned(provider, signed);
  if (sent.outcome === "refused") {
    await updateTxStatus(row._id, "failed").catch(() => {});
    throw new Error(`The network refused this ${label}, so nothing was sent: ${sent.reason}.`);
  }
  return { hash, row, sent };
}

export function settledStatus(err) {
  if (isError(err, "CALL_EXCEPTION") && err.receipt) return "failed";
  if (isError(err, "TRANSACTION_REPLACED")) {
    if (err.cancelled) return "failed";
    return err.receipt && err.receipt.status === 1 ? "confirmed" : "failed";
  }
  return null;
}

export async function waitForReceipt({ provider, hash, sent, waitMs }) {
  try {
    const receipt = sent && sent.response
      ? await sent.response.wait(1, waitMs)
      : await provider.waitForTransaction(hash, 1, waitMs);
    if (!receipt) return null;
    return receipt.status === 1 ? "confirmed" : "failed";
  } catch (err) {
    return settledStatus(err);
  }
}

export function trackConfirmation({ provider, hash, response, timeoutMs, onSettled }) {
  const waiting = response ? response.wait(1, timeoutMs) : provider.waitForTransaction(hash, 1, timeoutMs);
  return Promise.resolve(waiting)
    .then((receipt) => (receipt ? (receipt.status === 1 ? "confirmed" : "failed") : null))
    .catch((err) => settledStatus(err))
    .then((status) => {
      if (status && onSettled) {
        return Promise.resolve()
          .then(() => onSettled(status))
          .catch(() => {})
          .then(() => status);
      }
      return status;
    });
}
