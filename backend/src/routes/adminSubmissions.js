
const express = require("express");
const { pool } = require("../db");
const { authenticate } = require("../middleware/authenticate");
const { requirePermission } = require("../middleware/requirePermission");

const router = express.Router();

router.get(
  "/",
  authenticate,
  requirePermission("review_submissions"),
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT s.id, s.task_id, s.user_id, s.screenshot_url,
                s.submission_text, s.status, s.submitted_at,
                t.title AS task_title, u.name AS user_name
         FROM task_submissions s
         JOIN tasks t ON t.id = s.task_id
         JOIN users u ON u.id = s.user_id
         ORDER BY
           CASE WHEN s.status = 'pending' THEN 0 ELSE 1 END,
           s.submitted_at DESC
         LIMIT 200`
      );

      res.json({ submissions: result.rows });
    } catch (error) {
      console.error("Admin submissions error:", error.message);
      res.status(500).json({ error: "Could not load submissions." });
    }
  }
);

router.post(
  "/:id/review",
  authenticate,
  requirePermission("review_submissions"),
  async (req, res) => {
    const submissionId = Number(req.params.id);
    const decision = req.body.decision;
    const note =
      typeof req.body.note === "string" ? req.body.note.trim() : null;

    if (
      !Number.isSafeInteger(submissionId) ||
      submissionId < 1 ||
      !["approved", "rejected"].includes(decision)
    ) {
      return res.status(400).json({ error: "Invalid review request." });
    }

    if (note && note.length > 1000) {
      return res.status(400).json({ error: "Review note is too long." });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const found = await client.query(
        `SELECT s.id, s.task_id, s.user_id, s.status, t.reward
         FROM task_submissions s
         JOIN tasks t ON t.id = s.task_id
         WHERE s.id = $1
         FOR UPDATE OF s`,
        [submissionId]
      );

      if (!found.rowCount) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Submission not found." });
      }

      const submission = found.rows[0];

      if (submission.status !== "pending") {
        await client.query("ROLLBACK");
        return res.status(409).json({
          error: "This submission has already been reviewed."
        });
      }

      await client.query(
        `UPDATE task_submissions
         SET status = $1, reviewed_by = $2,
             review_note = $3, reviewed_at = NOW()
         WHERE id = $4`,
        [decision, req.user.id, note, submissionId]
      );

      if (decision === "approved") {
        await client.query(
          `INSERT INTO wallet_transactions
           (user_id, amount, type, reference_type, reference_id, description)
           VALUES ($1, $2, 'task_reward', 'task_submission', $3, $4)
           ON CONFLICT DO NOTHING`,
          [
            submission.user_id,
            submission.reward,
            submissionId,
            "Approved task reward"
          ]
        );
      }

      await client.query(
        `INSERT INTO audit_logs
         (actor_id, action, target_type, target_id, details)
         VALUES ($1, $2, 'task_submission', $3, $4::jsonb)`,
        [
          req.user.id,
          `submission_${decision}`,
          submissionId,
          JSON.stringify({ note })
        ]
      );

      await client.query("COMMIT");

      res.json({
        message: `Submission ${decision}.`,
        submissionId,
        status: decision
      });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Review error:", error.message);
      res.status(500).json({ error: "Could not review submission." });
    } finally {
      client.release();
    }
  }
);

module.exports = router;
