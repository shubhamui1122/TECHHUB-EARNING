const express = require("express");
const { pool } = require("../db");
const { authenticate } = require("../middleware/authenticate");

const router = express.Router();

router.get("/", authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         referral_code,
         created_at
       FROM users
       WHERE id = $1 AND status = 'active'
       LIMIT 1`,
      [req.user.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "User not found." });
    }

    const referral = result.rows[0];

    const countResult = await pool.query(
      `SELECT
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE status = 'rewarded') AS rewarded
       FROM referrals
       WHERE referrer_id = $1`,
      [req.user.id]
    );

    res.json({
      referralCode: referral.referral_code,
      totalReferrals: Number(countResult.rows[0].total),
      rewardedReferrals: Number(countResult.rows[0].rewarded)
    });
  } catch (error) {
    console.error("Referral error:", error.message);
    res.status(500).json({ error: "Could not load referrals." });
  }
});

module.exports = router;
