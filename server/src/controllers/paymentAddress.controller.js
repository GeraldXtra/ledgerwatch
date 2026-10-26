const { scopedRepo } = require("../repositories/scoped");
const { decimalToUnits, unitsToNumber } = require("../domain/money");
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
  stablecoinsFor,
} = require("../services/paymentAddress.service");
const {
  tokenBalanceUnits,
  confirmedUnsweptUnits,
  expireDueAddresses,
  TOLERANCE,
} = require("../services/paymentWatch.service");

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const OBJECT_ID_RE = /^[0-9a-fA-F]{24}$/;

function readDebtId(value) {
  if (value === undefined || value === null || value === "") return null;
  return OBJECT_ID_RE.test(String(value)) ? String(value) : false;
}

async function quote(req, res) {
  try {
    requireCryptoEnabled(req.user);
    const chainId = Number(req.query.chainId);
    const debtId = readDebtId(req.query.debtId);
    if (debtId === false || debtId === null) {
      return res.status(400).json({ error: "A valid invoice id is required to quote an address" });
    }
    const result = await quoteForInvoice({
      userId: req.user._id,
      debtId,
      chainId,
      tokenSymbol: req.query.tokenSymbol,
    });
    return res.json({ ...result, availableTokens: stablecoinsFor(chainId) });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error("payment address quote error:", err.message);
    return res.status(500).json({ error: "Failed to quote this invoice" });
  }
}

async function allocate(req, res) {
  try {
    requireCryptoEnabled(req.user);

    const chainId = Number(req.body.chainId);
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
      confirmations: confirmationsFor(chain.chainId, req.user),
      rate: { ngnPerToken: rate.rate, fetchedAt: rate.fetchedAt, stale: rate.stale },
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error("allocate index error:", err.message);
    return res.status(500).json({ error: "Failed to allocate a payment address" });
  }
}

async function create(req, res) {
  try {
    requireCryptoEnabled(req.user);
    const { debtId, chainId, address, derivationIndex, tokenSymbol } = req.body;
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
      tokenSymbol,
    });

    return res.status(201).json({
      paymentAddress: result.paymentAddress,
      chain: result.chain,
      rateStale: result.rateStale,
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
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

const PAGE_SIZE = 100;
const HOLDING_SCAN = 500;

async function list(req, res) {
  try {
    const repo = scopedRepo(req.user._id);
    const query = {};
    const debtId = readDebtId(req.query.debtId);
    if (debtId === false) return res.status(400).json({ error: "That is not a valid invoice id" });
    if (debtId) query.debtId = debtId;

    await expireDueAddresses({ userId: req.user._id, ...(debtId ? { debtId } : {}) });
    const page = await repo.paymentAddresses.find(query).sort({ createdAt: -1 }).limit(PAGE_SIZE);
    const total = await repo.paymentAddresses.countDocuments(query);

    let addresses = page;
    let holdingBeyondPage = 0;
    if (total > page.length) {
      const seen = new Set(page.map((a) => String(a._id)));
      const older = await repo.paymentAddresses.find({
        ...query,
        _id: { $nin: page.map((a) => a._id) },
        "observed.0": { $exists: true },
      })
        .sort({ createdAt: -1 })
        .limit(HOLDING_SCAN);

      const holding = older.filter((pa) => !seen.has(String(pa._id)) && confirmedUnsweptUnits(pa) > 1n);
      holdingBeyondPage = holding.length;
      addresses = [...page, ...holding];
    }

    const debts = await repo.debts.find({ _id: { $in: addresses.map((a) => a.debtId) } }).select("debtorName");
    const nameById = new Map(debts.map((d) => [String(d._id), d.debtorName]));

    const rows = addresses.map((a) => ({
      ...a.toObject(),
      debtorName: nameById.get(String(a.debtId)) || null,
      confirmationsRequired: confirmationsFor(a.chainId, req.user),
    }));

    const live = await getNgnRate();
    return res.json({
      addresses: rows,
      total,
      truncated: rows.length < total,
      holdingBeyondPage,
      chains: listChains(),
      currentRate: {
        ngnPerUsd: live.rate,
        fetchedAt: live.fetchedAt,
        stale: live.stale,
      },
    });
  } catch (err) {
    console.error("list payment addresses error:", err.message);
    return res.status(500).json({ error: "Failed to load payment addresses" });
  }
}

async function revoke(req, res) {
  try {
    const record = await scopedRepo(req.user._id).paymentAddresses.findById(req.params.id);
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

async function recordSweep(req, res) {
  try {
    const { txHash, destination, amountUsdc, gasFundedTxHash } = req.body;
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

    const record = await scopedRepo(req.user._id).paymentAddresses.findById(req.params.id);
    if (!record) return res.status(404).json({ error: "Payment address not found" });

    if (!record.sweeps.some((s) => s.txHash === txHash)) {
      record.sweeps.push({
        txHash,
        destination,
        amountUsdc: amount,
        gasFundedTxHash: gasFundedTxHash || null,
      });
    }

    let sweptNow = false;
    let residual = null;
    let balanceChecked = false;
    if (["paid", "expired", "revoked"].includes(record.status)) {
      const chain = getChain(record.chainId);
      if (chain && record.tokenContract) {
        const onChain = await tokenBalanceUnits(chain, record.tokenContract, record.address);
        if (onChain != null) {
          balanceChecked = true;
          residual = unitsToNumber(onChain, record.tokenDecimals);
          if (onChain <= decimalToUnits(TOLERANCE, record.tokenDecimals)) {
            record.status = "swept";
            sweptNow = true;
          }
        }
      }
    }

    await record.save();

    if (!sweptNow && ["paid", "expired", "revoked"].includes(record.status)) {
      console.warn(
        `[payment-address] sweep ${txHash} recorded on ${record.address} but it was NOT marked swept: ` +
          (balanceChecked
            ? `the chain still reports ${residual} ${record.tokenSymbol} there.`
            : "its balance could not be read, so it stays watched.")
      );
    }

    return res.status(201).json({
      paymentAddress: record,
      swept: sweptNow,
      balanceChecked,
      remainingOnChain: residual,
    });
  } catch (err) {
    console.error("record sweep error:", err.message);
    return res.status(500).json({ error: "Failed to record the sweep" });
  }
}

module.exports = { allocate, create, list, revoke, quote, recordSweep };
