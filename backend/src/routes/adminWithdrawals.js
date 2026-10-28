
const express = require("express");
const { pool } = require("../db");
const { authenticate } = require("../middleware/authenticate");
const { requirePermission } = require("../middleware/requirePermission");

const router = express.Router();

router.get(
  "/",
  authenticate,
  requirePermission("manage_withdrawals"),
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT id, user_id, amount, method, payment_details,
                status, requested_at
         FROM withdrawals
         WHERE status IN ('pending', 'approved')
         ORDER BY requested_at ASC
         LIMIT 200`
      );

      res.json({ withdrawals: result.rows });
    } catch (error) {
      console.error("Withdrawals review error:", error.message);
      res.status(500).json({ error: "Could not load withdrawals." });
    }
  }
);

router.post(
  "/:id/review",
  authenticate,
  requirePermission("manage_withdrawals"),
  async (req, res) => {
    const id = Number(req.params.id);
    const decision = req.body.decision;
    const note = typeof req.body.note === "string"
      ? req.body.note.trim()
      : null;

    if (
      !Number.isSafeInteger(id) ||
      id < 1 ||
      !["approved", "rejected"].includes(decision)
    ) {
      return res.status(400).json({ error: "Invalid review request." });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const found = await client.query(
        `SELECT id, user_id, amount, status
         FROM withdrawals
         WHERE id = $1
         FOR UPDATE`,
        [id]
      );

      if (!found.rowCount) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Withdrawal not found." });
      }

      const withdrawal = found.rows[0];

      if (withdrawal.status !== "pending") {
        await client.query("ROLLBACK");
        return res.status(409).json({
          error: "This withdrawal has already been reviewed."
        });
      }

      await client.query(
        `UPDATE withdrawals
         SET status = $1, reviewed_by = $2,
             review_note = $3, reviewed_at = NOW()
         WHERE id = $4`,
        [decision, req.user.id, note, id]
      );

      if (decision === "rejected") {
        await client.query(
          `INSERT INTO wallet_transactions
           (user_id, amount, type, reference_type, reference_id, description)
           VALUES ($1, $2, 'withdrawal_refund', 'withdrawal', $3, $4)`,
          [
            withdrawal.user_id,
            withdrawal.amount,
            id,
            "Withdrawal rejected; reserved amount released"
          ]
        );
      }

      await client.query(
        `INSERT INTO audit_logs
         (actor_id, action, target_type, target_id, details)
         VALUES ($1, $2, 'withdrawal', $3, $4::jsonb)`,
        [
          req.user.id,
          `withdrawal_${decision}`,
          id,
          JSON.stringify({ note })
        ]
      );

      await client.query("COMMIT");

      res.json({ message: `Withdrawal ${decision}.`, withdrawalId: id });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Withdrawal review error:", error.message);
      res.status(500).json({ error: "Could not review withdrawal." });
    } finally {
      client.release();
    }
  }
);

module.exports = router;
