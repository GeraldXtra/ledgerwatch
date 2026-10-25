const express = require("express");
const { rateLimit } = require("../middleware/rateLimit");
const { validate } = require("../middleware/validate");
const { z, text } = require("../validation/fields");
const { report } = require("../controllers/clientErrors.controller");

const router = express.Router();

const reportLimit = rateLimit({ windowMs: 10 * 60 * 1000, max: 20, name: "client-errors" });

const schema = {
  body: z.object({
    kind: z.enum(["render", "error", "rejection"]).optional(),
    message: text(1000).optional(),
    stack: text(4000).optional(),
    page: text(300).optional(),
  }),
};

router.post("/", reportLimit, validate(schema), report);

module.exports = router;
