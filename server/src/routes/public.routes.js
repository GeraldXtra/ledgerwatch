const express = require("express");
const { rateLimit } = require("../middleware/rateLimit");
const { validate } = require("../middleware/validate");
const schemas = require("../validation/public.schemas");
const pub = require("../controllers/public.controller");

const router = express.Router();

const readLimit = rateLimit({ windowMs: 60 * 1000, max: 60, name: "public-read" });
const writeLimit = rateLimit({ windowMs: 60 * 1000, max: 20, name: "public-write" });

router.get("/invoices/:token", readLimit, validate(schemas.invoice), pub.invoice);
router.get("/invoices/:token/invoice.pdf", readLimit, validate(schemas.invoice), pub.invoicePdf);
router.get("/unsubscribe/:token", readLimit, validate(schemas.unsubscribeInfo), pub.unsubscribeInfo);
router.post(
  "/unsubscribe/:token",
  writeLimit,
  express.urlencoded({ extended: false, limit: "1kb" }),
  validate(schemas.unsubscribeAct),
  pub.unsubscribeAct
);

module.exports = router;
