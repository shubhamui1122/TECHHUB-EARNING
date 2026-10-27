const express = require("express");
const { pool } = require("../db");
const { authenticate } = require("../middleware/authenticate");

const router = express.Router();

// List active tasks
router.get("/", authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         t.id,
         t.title,
         t.description,
         t.instructions,
         t.reward,
         t.requires_screenshot,
         t.requires_text,
         t.created_at,
         s.status AS submission_status
       FROM tasks t
       LEFT JOIN task_submissions s
         ON s.task_id = t.id AND s.user_id = $1
       WHERE t.status = 'active'
       ORDER BY t.created_at DESC`,
      [req.user.id]
    );

    res.json({ tasks: result.rows });
  } catch (error) {
    console.error("Tasks error:", error.message);
    res.status(500).json({ error: "Could not load tasks." });
  }
});

module.exports = router;
