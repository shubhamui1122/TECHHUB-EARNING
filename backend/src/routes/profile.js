
const express = require("express");
const { pool } = require("../db");
const { authenticate } = require("../middleware/authenticate");

const router = express.Router();

router.get("/", authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, email, mobile, referral_code, created_at
       FROM users
       WHERE id = $1 AND status = 'active'
       LIMIT 1`,
      [req.user.id]
    );

    if (!result.rowCount) {
      return res.status(404).json({ error: "Profile not found." });
    }

    res.json({ profile: result.rows[0] });
  } catch (error) {
    console.error("Profile error:", error.message);
    res.status(500).json({ error: "Could not load profile." });
  }
});

module.exports = router;
