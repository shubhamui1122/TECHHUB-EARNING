const express = require("express");
const { pool } = require("../db");
const { authenticate } = require("../middleware/authenticate");

const router = express.Router();

router.get("/", authenticate, async (req, res) => {
  try {
    const userId = req.user.id;

    const [userResult, balanceResult, taskResult, referralResult] =
      await Promise.all([
        pool.query(
          `SELECT id, name, email, mobile, referral_code, created_at
           FROM users
           WHERE id = $1 AND status = 'active'
           LIMIT 1`,
          [userId]
        ),

        pool.query(
          `SELECT
             COALESCE(
               SUM(
                 CASE
                   WHEN type IN ('task_reward', 'referral_reward', 'withdrawal_refund')
                     THEN amount
                   WHEN type = 'withdrawal'
                     THEN -amount
                   WHEN type = 'adjustment'
                     THEN amount
                   ELSE 0
                 END
               ),
               0
             ) AS balance
           FROM wallet_transactions
           WHERE user_id = $1`,
          [userId]
        ),

        pool.query(
          `SELECT
             COUNT(*) FILTER (WHERE status = 'pending') AS pending,
             COUNT(*) FILTER (WHERE status = 'approved') AS approved,
             COUNT(*) FILTER (WHERE status = 'rejected') AS rejected
           FROM task_submissions
           WHERE user_id = $1`,
          [userId]
        ),

        pool.query(
          `SELECT COUNT(*) AS total
           FROM referrals
           WHERE referrer_id = $1`,
          [userId]
        )
      ]);

    if (userResult.rowCount === 0) {
      return res.status(401).json({
        error: "Your account is unavailable. Please log in again."
      });
    }

    return res.json({
      user: userResult.rows[0],
      wallet: {
        balance: Number(balanceResult.rows[0].balance)
      },
      tasks: {
        pending: Number(taskResult.rows[0].pending),
        approved: Number(taskResult.rows[0].approved),
        rejected: Number(taskResult.rows[0].rejected)
      },
      referrals: {
        total: Number(referralResult.rows[0].total)
      }
    });
  } catch (error) {
    console.error("Dashboard error:", error.message);

    return res.status(500).json({
      error: "Could not load dashboard."
    });
  }
});

module.exports = router;
