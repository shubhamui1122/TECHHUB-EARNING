
const express = require("express");
const { pool } = require("../db");
const { authenticate } = require("../middleware/authenticate");
const { requirePermission } = require("../middleware/requirePermission");

const router = express.Router();

router.post(
  "/",
  authenticate,
  requirePermission("manage_tasks"),
  async (req, res) => {
    const { title, description, instructions } = req.body;
    const reward = Number(req.body.reward);
    const requiresScreenshot = req.body.requiresScreenshot;
    const requiresText = req.body.requiresText;

    if (
      typeof title !== "string" ||
      title.trim().length < 3 ||
      title.trim().length > 200 ||
      typeof description !== "string" ||
      !description.trim() ||
      typeof instructions !== "string" ||
      !instructions.trim()
    ) {
      return res.status(400).json({
        error: "Valid title, description, and instructions are required."
      });
    }

    if (
      !Number.isFinite(reward) ||
      reward < 0 ||
      reward > 100000 ||
      Math.round(reward * 100) !== reward * 100
    ) {
      return res.status(400).json({ error: "Invalid task reward." });
    }

    if (
      typeof requiresScreenshot !== "boolean" ||
      typeof requiresText !== "boolean" ||
      (!requiresScreenshot && !requiresText)
    ) {
      return res.status(400).json({
        error: "Require a screenshot, text, or both."
      });
    }

    try {
      const result = await pool.query(
        `INSERT INTO tasks
         (title, description, instructions, reward,
          requires_screenshot, requires_text, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          title.trim(),
          description.trim(),
          instructions.trim(),
          reward,
          requiresScreenshot,
          requiresText,
          req.user.id
        ]
      );

      await pool.query(
        `INSERT INTO audit_logs
         (actor_id, action, target_type, target_id, details)
         VALUES ($1, 'task_created', 'task', $2, $3::jsonb)`,
        [
          req.user.id,
          result.rows[0].id,
          JSON.stringify({ title: title.trim(), reward })
        ]
      );

      res.status(201).json({
        message: "Task created successfully.",
        task: result.rows[0]
      });
    } catch (error) {
      console.error("Task creation failed:", error.message);
      res.status(500).json({ error: "Could not create task." });
    }
  }
);

module.exports = router;
