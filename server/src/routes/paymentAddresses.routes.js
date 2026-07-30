const express = require("express");
const requireAuth = require("../middleware/auth");
const {
  allocate,
  create,
  list,
  revoke,
  quote,
  recordSweep,
} = require("../controllers/paymentAddress.controller");

const router = express.Router();

// Every route is authenticated and scoped to req.user. The server only ever
// handles PUBLIC addresses and derivation indices — never a key or a seed.
router.use(requireAuth);

router.get("/quote", quote); // preview figures — reserves nothing
router.post("/allocate", allocate); // reserve an index (atomic)
router.post("/", create); // record the browser-derived address
router.get("/", list);
router.patch("/:id/revoke", revoke);
router.post("/:id/sweeps", recordSweep); // bookkeeping for a browser-signed sweep

module.exports = router;
