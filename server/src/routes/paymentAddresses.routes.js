const express = require("express");
const requireAuth = require("../middleware/auth");
const {
  allocate,
  create,
  list,
  revoke,
} = require("../controllers/paymentAddress.controller");

const router = express.Router();

// Every route is authenticated and scoped to req.user. The server only ever
// handles PUBLIC addresses and derivation indices — never a key or a seed.
router.use(requireAuth);

router.post("/allocate", allocate); // reserve an index (atomic)
router.post("/", create); // record the browser-derived address
router.get("/", list);
router.patch("/:id/revoke", revoke);

module.exports = router;
