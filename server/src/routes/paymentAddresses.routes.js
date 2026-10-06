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

router.use(requireAuth);

router.get("/quote", quote);
router.post("/allocate", require("../middleware/rateLimit").allocate, allocate);
router.post("/", create);
router.get("/", list);
router.patch("/:id/revoke", revoke);
router.post("/:id/sweeps", recordSweep);

module.exports = router;
