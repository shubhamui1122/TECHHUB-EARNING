
const express = require("express");
const bcrypt = require("bcryptjs");
const { pool } = require("./db");
const { authenticate } = require("./middleware/authenticate");
const requireRole = require("./middleware/requireRole");

const router = express.Router();

const ALLOWED_PERMISSIONS = [
  "manage_users",
  "manage_tasks",
  "review_submissions",
  "manage_withdrawals",
  "manage_support",
  "view_reports"
];

router.use(authenticate);
router.use(requireRole("owner"));

router.post("/admins", async (req, res) => {
  const name =
    typeof req.body.name === "string"
      ? req.body.name.trim()
      : "";

  const email =
    typeof req.body.email === "string"
      ? req.body.email.trim().toLowerCase()
      : "";

  const mobile =
    typeof req.body.mobile === "string"
      ? req.body.mobile.trim()
      : "";

  const password =
    typeof req.body.password === "string"
      ? req.body.password
      : "";

  const permissions = req.body.permissions;

  if (name.length < 2 || name.length > 100) {
    return res.status(400).json({
      error: "Name must be between 2 and 100 characters."
    });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({
      error: "Enter a valid email address."
    });
  }

  if (!/^\+?[0-9]{10,15}$/.test(mobile)) {
    return res.status(400).json({
      error: "Enter a valid mobile number."
    });
  }

  if (password.length < 10 || password.length > 72) {
    return res.status(400).json({
      error: "Password must be between 10 and 72 characters."
    });
  }

  if (
    !Array.isArray(permissions) ||
    permissions.some(
      (permission) =>
        typeof permission !== "string" ||
        !ALLOWED_PERMISSIONS.includes(permission)
    )
  ) {
    return res.status(400).json({
      error: "Invalid permissions list."
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const duplicate = await client.query(
      `SELECT id FROM users
       WHERE email = $1 OR mobile = $2
       LIMIT 1`,
      [email, mobile]
    );

    if (duplicate.rowCount > 0) {
      await client.query("ROLLBACK");

      return res.status(409).json({
        error: "Email or mobile number is already registered."
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const created = await client.query(
      `INSERT INTO users
       (name, email, mobile, password_hash, role, status)
       VALUES ($1, $2, $3, $4, 'admin', 'active')
       RETURNING id, name, email, mobile, role, status, created_at`,
      [name, email, mobile, passwordHash]
    );

    const admin = created.rows[0];

    for (const permission of new Set(permissions)) {
      await client.query(
        `INSERT INTO admin_permissions
         (admin_id, permission, granted_by)
         VALUES ($1, $2, $3)`,
        [admin.id, permission, req.user.id]
      );
    }

    await client.query(
      `INSERT INTO audit_logs
       (actor_id, action, target_type, target_id, details)
       VALUES ($1, 'admin_created', 'user', $2, $3::jsonb)`,
      [
        req.user.id,
        admin.id,
        JSON.stringify({
          permissions: [...new Set(permissions)]
        })
      ]
    );

    await client.query("COMMIT");

    return res.status(201).json({
      message: "Admin account created successfully.",
      admin,
      permissions: [...new Set(permissions)]
    });
  } catch (error) {
    await client.query("ROLLBACK");

    console.error("Admin creation failed:", error.message);

    return res.status(500).json({
      error: "Could not create admin account."
    });
  } finally {
    client.release();
  }
});

router.put("/admins/:id/permissions", async (req, res) => {
  const adminId = Number(req.params.id);
  const permissions = req.body.permissions;

  if (!Number.isSafeInteger(adminId) || adminId < 1) {
    return res.status(400).json({
      error: "Invalid admin ID."
    });
  }

  if (
    !Array.isArray(permissions) ||
    permissions.some(
      (permission) =>
        typeof permission !== "string" ||
        !ALLOWED_PERMISSIONS.includes(permission)
    )
  ) {
    return res.status(400).json({
      error: "Invalid permissions list."
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const target = await client.query(
      `SELECT id FROM users
       WHERE id = $1 AND role = 'admin'
       FOR UPDATE`,
      [adminId]
    );

    if (target.rowCount === 0) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        error: "Admin account not found."
      });
    }

    await client.query(
      "DELETE FROM admin_permissions WHERE admin_id = $1",
      [adminId]
    );

    const uniquePermissions = [...new Set(permissions)];

    for (const permission of uniquePermissions) {
      await client.query(
        `INSERT INTO admin_permissions
         (admin_id, permission, granted_by)
         VALUES ($1, $2, $3)`,
        [adminId, permission, req.user.id]
      );
    }

    await client.query(
      `INSERT INTO audit_logs
       (actor_id, action, target_type, target_id, details)
       VALUES ($1, 'admin_permissions_updated', 'user', $2, $3::jsonb)`,
      [
        req.user.id,
        adminId,
        JSON.stringify({ permissions: uniquePermissions })
      ]
    );

    await client.query("COMMIT");

    return res.json({
      message: "Admin permissions updated.",
      adminId,
      permissions: uniquePermissions
    });
  } catch (error) {
    await client.query("ROLLBACK");

    console.error("Permission update failed:", error.message);

    return res.status(500).json({
      error: "Could not update admin permissions."
    });
  } finally {
    client.release();
  }
});

router.get("/admins", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         u.id, u.name, u.email, u.mobile, u.status, u.created_at,
         COALESCE(
           array_agg(ap.permission)
             FILTER (WHERE ap.permission IS NOT NULL),
           ARRAY[]::varchar[]
         ) AS permissions
       FROM users u
       LEFT JOIN admin_permissions ap ON ap.admin_id = u.id
       WHERE u.role = 'admin'
       GROUP BY u.id
       ORDER BY u.created_at DESC`
    );

    return res.json({ admins: result.rows });
  } catch (error) {
    console.error("Admin listing failed:", error.message);

    return res.status(500).json({
      error: "Could not load admins."
    });
  }
});

module.exports = router;
