const express = require("express");
const requireAuth = require("../middleware/auth");
const { rpcProxy, walletSecuritySet } = require("../middleware/rateLimit");
const { validate } = require("../middleware/validate");
const schemas = require("../validation/wallet.schemas");
const wallet = require("../controllers/wallet.controller");
const walletSecurity = require("../controllers/walletSecurity.controller");

const router = express.Router();

router.use(requireAuth);

router.get("/chains", validate(schemas.chains), wallet.chains);
router.post("/rpc/:chainId", rpcProxy, validate(schemas.rpc), wallet.rpc);
router.post("/address", validate(schemas.setAddress), wallet.setAddress);
router.delete("/address", validate(schemas.clearAddress), wallet.clearAddress);
router.get("/txs", validate(schemas.listTxs), wallet.listTxs);
router.get("/spend", validate(schemas.spend), wallet.spend24h);
router.post("/txs", validate(schemas.recordTx), wallet.recordTx);
router.patch("/txs/:id", validate(schemas.updateTxStatus), wallet.updateTxStatus);
router.get("/discovered", validate(schemas.discovered), wallet.discovered);
router.get("/chain-addresses", validate(schemas.listChainAddresses), wallet.listChainAddresses);
router.post("/chain-addresses", validate(schemas.setChainAddress), wallet.setChainAddress);
router.post("/discovered/:chainId/:address", validate(schemas.discoveredAct), wallet.discoveredAct);

router.get("/security", validate(schemas.securityGet), walletSecurity.get);
router.put("/security", walletSecuritySet, validate(schemas.securitySet), walletSecurity.set);
router.post("/security/verify", validate(schemas.securityVerify), walletSecurity.verify);

module.exports = router;
