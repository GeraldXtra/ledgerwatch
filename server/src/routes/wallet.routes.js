const express = require("express");
const requireAuth = require("../middleware/auth");
const wallet = require("../controllers/wallet.controller");
const walletSecurity = require("../controllers/walletSecurity.controller");

const router = express.Router();

router.use(requireAuth);

router.get("/chains", wallet.chains);
router.post("/rpc/:chainId", require("../middleware/rateLimit").rpcProxy, wallet.rpc);
router.post("/address", wallet.setAddress);
router.delete("/address", wallet.clearAddress);
router.get("/txs", wallet.listTxs);
router.get("/spend", wallet.spend24h);
router.post("/txs", wallet.recordTx);
router.patch("/txs/:id", wallet.updateTxStatus);
router.get("/discovered", wallet.discovered);
router.get("/chain-addresses", wallet.listChainAddresses);
router.post("/chain-addresses", wallet.setChainAddress);
router.post("/discovered/:chainId/:address", wallet.discoveredAct);

router.get("/security", walletSecurity.get);
router.put("/security", require("../middleware/rateLimit").walletSecuritySet, walletSecurity.set);
router.post("/security/verify", walletSecurity.verify);

module.exports = router;
