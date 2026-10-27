const express = require("express");
const { pool } = require("../db");
const { authenticate } = require("../middleware/authenticate");

const router = express.Router();

router.post("/", authenticate, async (req, res) => {
  const message =
    typeof req.body.message === "string"
      ? req.body.message.trim()
      : "";

  if (message.length < 10 || message.length > 2000) {
    return res.status(400).json({
      error: "Message must be between 10 and 2000 characters."
    });
  }

  try {
    // Support table will be added in the next database migration.
    const result = await pool.query(
      `SELECT to_regclass('public.support_tickets') AS table_name`
    );

    if (!result.rows[0].table_name) {
      return res.status(503).json({
        error: "Support service is not configured yet."
      });
    }

    await pool.query(
      `INSERT INTO support_tickets (user_id, message, status)
       VALUES ($1, $2, 'open')`,
      [req.user.id, message]
    );

    return res.status(201).json({
      message: "Support request submitted successfully."
    });
  } catch (error) {
    console.error("Support error:", error.message);
    return res.status(500).json({
      error: "Could not submit support request."
    });
  }
});

module.exports = router;
