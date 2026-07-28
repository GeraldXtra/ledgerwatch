const express = require("express");
const requireAuth = require("../middleware/auth");
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
} = require("../controllers/debts.controller");
const payments = require("../controllers/payments.controller");

const router = express.Router();

// All receivables routes require auth and are scoped to req.user.
router.use(requireAuth);

router.post("/", create);
router.get("/", list);
router.get("/:id", getOne);
router.patch("/:id", update);
router.delete("/:id", remove);

router.patch("/:id/paid", markPaid);
router.get("/:id/reminders", listReminders);
router.post("/:id/remind", remind);
router.post("/:id/send", send);

// Partial payments + receipts (nested under a debt).
router.post("/:id/payments", payments.record);
router.get("/:id/payments", payments.list);
router.delete("/:id/payments/:paymentId", payments.remove);
router.get("/:id/receipt", payments.receipt);

module.exports = router;
