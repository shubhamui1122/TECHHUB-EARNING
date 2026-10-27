const { requireRole } = require("./requireRole");

const requireAdmin = requireRole("admin", "owner");

module.exports = { requireAdmin };
