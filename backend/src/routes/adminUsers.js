
const express = require("express");
const { pool } = require("../db");
const { authenticate } = require("../middleware/authenticate");
const { requirePermission } = require("../middleware/requirePermission");

const router = express.Router();

router.get(
  "/",
  authenticate,
  requirePermission("manage_users"),
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT id, name, email, mobile, role, status, created_at
         FROM users
         WHERE role = 'user'
         ORDER BY created_at DESC
         LIMIT 200`
      );

      res.json({ users: result.rows });
    } catch (error) {
      console.error("Admin users error:", error.message);
      res.status(500).json({ error: "Could not load users." });
    }
  }
);

router.patch(
  "/:id/status",
  authenticate,
  requirePermission("manage_users"),
  async (req, res) => {
    const id = Number(req.params.id);
    const status = req.body.status;

    if (
      !Number.isSafeInteger(id) ||
      id < 1 ||
      !["active", "disabled"].includes(status)
    ) {
      return res.status(400).json({ error: "Invalid status request." });
    }

    try {
      const result = await pool.query(
        `UPDATE users
         SET status = $1, updated_at = NOW()
         WHERE id = $2 AND role = 'user'
         RETURNING id, name, email, status`,
        [status, id]
      );

      if (!result.rowCount) {
        return res.status(404).json({ error: "User not found." });
      }

      await pool.query(
        `INSERT INTO audit_logs
         (actor_id, action, target_type, target_id, details)
         VALUES ($1, 'user_status_updated', 'user', $2, $3::jsonb)`,
        [req.user.id, id, JSON.stringify({ status })]
      );

      res.json({ user: result.rows[0] });
    } catch (error) {
      console.error("User status error:", error.message);
      res.status(500).json({ error: "Could not update user status." });
    }
  }
);

module.exports = router;
