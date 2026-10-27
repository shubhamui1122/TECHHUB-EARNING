const { requireRole } = require("./requireRole");

const requireOwner = requireRole("owner");

module.exports = { requireOwner };
