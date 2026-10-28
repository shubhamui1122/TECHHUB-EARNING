
const express = require("express");
const { pool } = require("../db");
const { authenticate } = require("../middleware/authenticate");

const router = express.Router();

// Submit a task
router.post("/", authenticate, async (req, res) => {
  const taskId = Number(req.body.taskId);
  const screenshotUrl =
    typeof req.body.screenshotUrl === "string"
      ? req.body.screenshotUrl.trim()
      : null;
  const submissionText =
    typeof req.body.submissionText === "string"
      ? req.body.submissionText.trim()
      : null;

  if (!Number.isSafeInteger(taskId) || taskId < 1) {
    return res.status(400).json({ error: "Invalid task ID." });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const taskResult = await client.query(
      `SELECT id, requires_screenshot, requires_text
       FROM tasks
       WHERE id = $1 AND status = 'active'
       FOR SHARE`,
      [taskId]
    );

    if (!taskResult.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Task not found or inactive." });
    }

    const task = taskResult.rows[0];

    if (task.requires_screenshot && !screenshotUrl) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Screenshot is required." });
    }

    if (task.requires_text && !submissionText) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Submission text is required." });
    }

    if (screenshotUrl && !/^https:\/\/\S+$/i.test(screenshotUrl)) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: "Screenshot must use a valid HTTPS URL."
      });
    }

    const result = await client.query(
      `INSERT INTO task_submissions
       (task_id, user_id, screenshot_url, submission_text)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (task_id, user_id) DO NOTHING
       RETURNING id, task_id, status, submitted_at`,
      [taskId, req.user.id, screenshotUrl, submissionText]
    );

    if (!result.rowCount) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        error: "You have already submitted this task."
      });
    }

    await client.query("COMMIT");

    res.status(201).json({
      message: "Task submission received for review.",
      submission: result.rows[0]
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Submission error:", error.message);
    res.status(500).json({ error: "Could not submit task." });
  } finally {
    client.release();
  }
});

module.exports = router;
