const express = require("express");
const requireAuth = require("../middleware/auth");
const wallet = require("../controllers/wallet.controller");
const walletSecurity = require("../controllers/walletSecurity.controller");

const router = express.Router();

// Every wallet route is authenticated and user-scoped. The server only ever sees
// PUBLIC data (address, tx hashes) and proxied RPC calls — never a private key.
router.use(requireAuth);

router.get("/chains", wallet.chains);
// Throttled per user: one account must not be able to exhaust the operator's
// upstream quota, and a wallet never needs more than a few calls a second.
router.post("/rpc/:chainId", require("../middleware/rateLimit").rpcProxy, wallet.rpc);
router.post("/address", wallet.setAddress);
router.delete("/address", wallet.clearAddress);
router.get("/txs", wallet.listTxs);
// The last twenty four hours of live swap spend, for the daily cap.
router.get("/spend", wallet.spend24h);
router.post("/txs", wallet.recordTx);
router.patch("/txs/:id", wallet.updateTxStatus);
// Tokens that arrived which the wallet had never been told about, and the
// owner's decision on each. Nothing is added to the wallet without that click.
router.get("/discovered", wallet.discovered);
router.post("/discovered/:chainId/:address", wallet.discoveredAct);

/**
 * OPTIONAL extra verification before a wallet reveals its secrets.
 *
 * These endpoints handle QUESTION PROMPTS AND ANSWER HASHES ONLY. No recovery
 * phrase and no private key passes through here, or through any other route —
 * the keystore is decrypted in the browser and the plaintext never leaves it.
 */
router.get("/security", walletSecurity.get);
router.put("/security", walletSecurity.set);
router.post("/security/verify", walletSecurity.verify);

module.exports = router;
