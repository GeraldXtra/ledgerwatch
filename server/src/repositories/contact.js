const ContactMessage = require("../models/ContactMessage");

module.exports = {
  create: (fields) => ContactMessage.create(fields),
};
