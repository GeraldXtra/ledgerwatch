const PaymentAddress = require("../models/PaymentAddress");
const Debt = require("../models/Debt");
const { getChain, listChains } = require("../config/chains");
const {
  confirmationsFor,
  requireCryptoEnabled,
} = require("../services/cryptoSettings.service");
const {
  allocateIndex,
  issueAddress,
  getNgnRate,
  quoteForInvoice,
} = require("../services/paymentAddress.service");

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const HASH_RE = /^0x[0-9a-fA-F]{64}$/;

/**
 * GET /api/payment-addresses/quote?debtId=&chainId=
 *
 * What issuing an address WOULD ask for, without reserving anything. The
 * confirmation screen needs the balance, USDC amount, rate and rate age up
 * front; using /allocate for that would consume a derivation index every time a
 * dialog was opened and abandoned.
 */
async function quote(req, res) {
  try {
    requireCryptoEnabled(req.user);
    const result = await quoteForInvoice({
      userId: req.user._id,
      debtId: req.query.debtId,
      chainId: Number(req.query.chainId),
    });
    return res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error("payment address quote error:", err.message);
    return res.status(500).json({ error: "Failed to quote this invoice" });
  }
}

/**
 * POST /api/payment-addresses/allocate  { chainId }
 *
 * Step 1 of a two-step issue. Reserves the next derivation index atomically and
 * returns it plus the chain/token context. The client then derives the address
 * for that index IN THE BROWSER and posts it back to /issue. The server never
 * sees a key or a seed at any point.
 */
async function allocate(req, res) {
  try {
    // Checked BEFORE an index is reserved: allocation permanently consumes one,
    // so a disabled account must be turned away before it burns anything.
    requireCryptoEnabled(req.user);

    const chainId = Number(req.body && req.body.chainId);
    const chain = getChain(chainId);
    if (!chain) return res.status(400).json({ error: "Unknown or disabled chain" });

    const token = (chain.tokens || [])[0];
    if (!token) {
      return res.status(400).json({ error: `No stablecoin configured for ${chain.name}` });
    }

    const derivationIndex = await allocateIndex(req.user._id);
    const rate = await getNgnRate();

    return res.json({
      derivationIndex,
      chain: {
        chainId: chain.chainId,
        name: chain.name,
        explorer: chain.explorer,
        testnet: chain.testnet,
      },
      token,
      // The user's own depth if they set one, otherwise the per-chain default.
      confirmations: confirmationsFor(chain.chainId, req.user),
      rate: { ngnPerToken: rate.rate, fetchedAt: rate.fetchedAt, stale: rate.stale },
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error("allocate index error:", err.message);
    return res.status(500).json({ error: "Failed to allocate a payment address" });
  }
}

/**
 * POST /api/payment-addresses  { debtId, chainId, address, derivationIndex }
 * Step 2: record the browser-derived address against the invoice.
 */
async function create(req, res) {
  try {
    requireCryptoEnabled(req.user);
    const { debtId, chainId, address, derivationIndex } = req.body || {};
    if (!ADDRESS_RE.test(address || "")) {
      return res.status(400).json({ error: "Invalid address" });
    }
    if (!Number.isInteger(derivationIndex) || derivationIndex < 0) {
      return res.status(400).json({ error: "Invalid derivation index" });
    }

    const result = await issueAddress({
      userId: req.user._id,
      debtId,
      chainId: Number(chainId),
      address,
      derivationIndex,
    });

    return res.status(201).json({
      paymentAddress: result.paymentAddress,
      chain: result.chain,
      rateStale: result.rateStale,
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    // A duplicate key means one of the unique guards caught something that must
    // never happen. Surface it loudly rather than letting two invoices share an
    // address, and name which guard fired — they mean different things.
    if (err.code === 11000) {
      const onAddress = /address/.test(err.message || "") && !/derivationIndex/.test(err.message || "");
      return res.status(409).json({
        error: onAddress
          ? "That address is already in use by another invoice. This happens if the same recovery phrase is used by more than one account; use a separate wallet for each."
          : "That derivation index is already in use. Please try again.",
      });
    }
    console.error("create payment address error:", err.message);
    return res.status(500).json({ error: "Failed to create the payment address" });
  }
}

// GET /api/payment-addresses?debtId=  -> addresses for an invoice (or all).
async function list(req, res) {
  try {
    const query = { userId: req.user._id };
    if (req.query.debtId) query.debtId = req.query.debtId;
    const addresses = await PaymentAddress.find(query).sort({ createdAt: -1 }).limit(100);

    // Attach the debtor name as a SEPARATE field rather than populating `debtId`.
    // The sweep list needs to say which client an address belongs to, and
    // populating would turn debtId from an id into an object for every existing
    // caller.
    const debts = await Debt.find({
      _id: { $in: addresses.map((a) => a.debtId) },
      userId: req.user._id,
    }).select("debtorName");
    const nameById = new Map(debts.map((d) => [String(d._id), d.debtorName]));

    const rows = addresses.map((a) => ({
      ...a.toObject(),
      debtorName: nameById.get(String(a.debtId)) || null,
    }));

    return res.json({ addresses: rows, chains: listChains() });
  } catch (err) {
    console.error("list payment addresses error:", err.message);
    return res.status(500).json({ error: "Failed to load payment addresses" });
  }
}

// PATCH /api/payment-addresses/:id/revoke -> stop watching early.
async function revoke(req, res) {
  try {
    const record = await PaymentAddress.findOne({ _id: req.params.id, userId: req.user._id });
    if (!record) return res.status(404).json({ error: "Payment address not found" });
    if (record.status !== "active") {
      return res.status(409).json({ error: `Address is already ${record.status}` });
    }
    record.status = "revoked";
    await record.save();
    return res.json({ paymentAddress: record });
  } catch (err) {
    console.error("revoke payment address error:", err.message);
    return res.status(500).json({ error: "Failed to revoke the address" });
  }
}

/**
 * POST /api/payment-addresses/:id/sweeps
 * { txHash, destination, amountUsdc, gasFundedTxHash }
 *
 * Records a sweep the user has already signed and broadcast in their browser.
 * The server never signs and never holds a key, so this is bookkeeping: the
 * transaction is already on chain by the time this is called.
 */
async function recordSweep(req, res) {
  try {
    const { txHash, destination, amountUsdc, gasFundedTxHash } = req.body || {};
    if (!HASH_RE.test(txHash || "")) {
      return res.status(400).json({ error: "Invalid transaction hash" });
    }
    if (!ADDRESS_RE.test(destination || "")) {
      return res.status(400).json({ error: "Invalid destination address" });
    }
    if (gasFundedTxHash && !HASH_RE.test(gasFundedTxHash)) {
      return res.status(400).json({ error: "Invalid gas funding transaction hash" });
    }
    const amount = Number(amountUsdc);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: "Invalid swept amount" });
    }

    const record = await PaymentAddress.findOne({ _id: req.params.id, userId: req.user._id });
    if (!record) return res.status(404).json({ error: "Payment address not found" });

    // Idempotent: a retry after a dropped response must not append twice.
    if (!record.sweeps.some((s) => s.txHash === txHash)) {
      record.sweeps.push({
        txHash,
        destination,
        amountUsdc: amount,
        gasFundedTxHash: gasFundedTxHash || null,
      });
    }

    /**
     * `swept` is set NARROWLY, and only for an address that is finished
     * collecting. An address that is still `active` is still expected to receive
     * a top up, and flipping it here would stop the watcher and silently lose
     * that payment. Sweeping moves what has arrived; it does not close an
     * invoice. The sweeps array records the movement either way.
     */
    if (["paid", "expired", "revoked"].includes(record.status)) {
      record.status = "swept";
    }

    await record.save();
    return res.status(201).json({ paymentAddress: record });
  } catch (err) {
    console.error("record sweep error:", err.message);
    return res.status(500).json({ error: "Failed to record the sweep" });
  }
}

module.exports = { allocate, create, list, revoke, quote, recordSweep };
