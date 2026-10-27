const { pool } = require("../db");

function requirePermission(permission) {
  return async function (req, res, next) {
    if (!req.user) {
      return res.status(401).json({
        error: "Please log in first."
      });
    }

    if (req.user.role === "owner") {
      return next();
    }

    if (req.user.role !== "admin") {
      return res.status(403).json({
        error: "Admin access required."
      });
    }

    try {
      const result = await pool.query(
        `SELECT 1
         FROM admin_permissions
         WHERE admin_id = $1
           AND permission = $2
         LIMIT 1`,
        [req.user.id, permission]
      );

      if (result.rowCount === 0) {
        return res.status(403).json({
          error: "You do not have this permission."
        });
      }

      return next();
    } catch (error) {
      console.error("Permission check failed:", error.message);

      return res.status(500).json({
        error: "Could not verify permissions."
      });
    }
  };
}

module.exports = { requirePermission };
