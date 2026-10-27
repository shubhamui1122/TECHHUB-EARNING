
const express = require("express");
const { pool } = require("../db");
const { authenticate } = require("../middleware/authenticate");

const router = express.Router();

router.get("/", authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, amount, method, status, review_note,
              payment_reference, requested_at, reviewed_at, paid_at
       FROM withdrawals
       WHERE user_id = $1
       ORDER BY requested_at DESC`,
      [req.user.id]
    );

    res.json({ withdrawals: result.rows });
  } catch (error) {
    console.error("Withdrawals error:", error.message);
    res.status(500).json({ error: "Could not load withdrawals." });
  }
});

router.post("/", authenticate, async (req, res) => {
  const amount = Number(req.body.amount);
  const method = req.body.method;
  const details = req.body.paymentDetails;

  if (!Number.isFinite(amount) || amount < 50 || !["upi", "bank"].includes(method)) {
    return res.status(400).json({
      error: "Minimum withdrawal is ₹50. Choose UPI or bank."
    });
  }

  if (!details || typeof details !== "object" || Array.isArray(details)) {
    return res.status(400).json({ error: "Valid payment details are required." });
  }

  const keys = method === "upi"
    ? ["upiId"]
    : ["accountName", "accountNumber", "ifsc"];

  for (const key of keys) {
    if (typeof details[key] !== "string" || !details[key].trim()) {
      return res.status(400).json({
        error: `Missing payment detail: ${key}`
      });
    }
  }

  if (Object.keys(details).some((key) => !keys.includes(key))) {
    return res.status(400).json({
      error: "Unexpected payment detail field."
    });
  }

  if (amount > 1000000 || Math.round(amount * 100) !== amount * 100) {
    return res.status(400).json({ error: "Invalid withdrawal amount." });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const balanceResult = await client.query(
      `SELECT COALESCE(SUM(
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

    const balance = Number(balanceResult.rows[0].balance);

    const pendingResult = await client.query(
      `SELECT COALESCE(SUM(amount), 0) AS pending
       FROM withdrawals
       WHERE user_id = $1 AND status IN ('pending', 'approved')`,
      [req.user.id]
    );

    const available = balance - Number(pendingResult.rows[0].pending);

    if (amount > available) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: "Insufficient available balance."
      });
    }

    const created = await client.query(
      `INSERT INTO withdrawals
       (user_id, amount, method, payment_details, status)
       VALUES ($1, $2, $3, $4::jsonb, 'pending')
       RETURNING id, amount, method, status, requested_at`,
      [
        req.user.id,
        amount,
        method,
        JSON.stringify(
          Object.fromEntries(
            keys.map((key) => [key, details[key].trim()])
          )
        )
      ]
    );

    await client.query("COMMIT");

    return res.status(201).json({
      message: "Withdrawal request submitted for review.",
      withdrawal: created.rows[0]
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Withdrawal request failed:", error.message);

    return res.status(500).json({
      error: "Could not submit withdrawal request."
    });
  } finally {
    client.release();
  }
});

module.exports = router;
