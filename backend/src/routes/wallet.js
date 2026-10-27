
const express = require("express");
const { pool } = require("../db");
const { authenticate } = require("../middleware/authenticate");

const router = express.Router();

router.get("/", authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         COALESCE(SUM(
           CASE
             WHEN type IN ('task_reward', 'referral_reward', 'withdrawal_refund')
               THEN amount
             WHEN type = 'withdrawal'
               THEN -amount
             WHEN type = 'adjustment'
               THEN amount
             ELSE 0
           END
         ), 0) AS balance
       FROM wallet_transactions
       WHERE user_id = $1`,
      [req.user.id]
    );

    res.json({
      currency: "INR",
      balance: Number(result.rows[0].balance)
    });
  } catch (error) {
    console.error("Wallet error:", error.message);
    res.status(500).json({ error: "Could not load wallet." });
  }
});

module.exports = router;
