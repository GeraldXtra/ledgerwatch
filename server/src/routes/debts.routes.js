const express = require("express");
const requireAuth = require("../middleware/auth");
const { validate } = require("../middleware/validate");
const schemas = require("../validation/debts.schemas");
const {
  create,
  list,
  getOne,
  update,
  remove,
  markPaid,
  listReminders,
  remind,
  send,
  invoicePdf,
  share,
} = require("../controllers/debts.controller");
const payments = require("../controllers/payments.controller");

const router = express.Router();

router.use(requireAuth);

router.post("/", validate(schemas.create), create);
router.get("/", validate(schemas.list), list);
router.get("/:id", validate(schemas.byId), getOne);
router.patch("/:id", validate(schemas.update), update);
router.delete("/:id", validate(schemas.remove), remove);
router.patch("/:id/paid", validate(schemas.byId), markPaid);
router.get("/:id/reminders", validate(schemas.byId), listReminders);
router.post("/:id/remind", validate(schemas.byId), remind);
router.post("/:id/send", validate(schemas.send), send);
router.post("/:id/payments", validate(schemas.recordPayment), payments.record);
router.get("/:id/payments", validate(schemas.byId), payments.list);
router.delete("/:id/payments/:paymentId", validate(schemas.removePayment), payments.remove);
router.get("/:id/receipt", validate(schemas.receipt), payments.receipt);
router.get("/:id/invoice.pdf", validate(schemas.byId), invoicePdf);
router.post("/:id/share", validate(schemas.share), share);

module.exports = router;
