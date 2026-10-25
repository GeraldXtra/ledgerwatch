const express = require("express");
const requireAuth = require("../middleware/auth");
const { allocate: allocateLimit } = require("../middleware/rateLimit");
const { validate } = require("../middleware/validate");
const schemas = require("../validation/paymentAddresses.schemas");
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

router.get("/quote", validate(schemas.quote), quote);
router.post("/allocate", allocateLimit, validate(schemas.allocate), allocate);
router.post("/", validate(schemas.create), create);
router.get("/", validate(schemas.list), list);
router.patch("/:id/revoke", validate(schemas.revoke), revoke);
router.post("/:id/sweeps", validate(schemas.recordSweep), recordSweep);

module.exports = router;
