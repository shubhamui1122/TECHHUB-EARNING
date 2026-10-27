
const { query } = require("../db");

function requirePermission(...allowedPermissions) {
  return async function (req, res, next) {
    try {
      if (!req.user) {
        return res.status(401).json({
          error: "Please log in first."
        });
      }

      // Owner पर Admin permissions लागू नहीं होंगी।
      if (req.user.role === "owner") {
        return next();
      }

      if (req.user.role !== "admin") {
        return res.status(403).json({
          error: "Admin access required."
        });
      }

      if (allowedPermissions.length === 0) {
        return res.status(403).json({
          error: "No permission specified."
        });
      }

      const result = await query(
        `SELECT permission
         FROM admin_permissions
         WHERE admin_id = $1
           AND permission = ANY($2::text[])`,
        [req.user.id, allowedPermissions]
      );

      if (result.rows.length === 0) {
        return res.status(403).json({
          error: "You do not have the required permission."
        });
      }

      next();
    } catch (error) {
      console.error("Permission check failed:", error.message);

      return res.status(500).json({
        error: "Could not verify permissions."
      });
    }
  };
}

module.exports = requirePermission;
