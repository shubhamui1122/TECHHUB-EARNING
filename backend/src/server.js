require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const authRoutes = require("./auth");
const adminRoutes = require("./admin");

const app = express();
const PORT = Number(process.env.PORT) || 5000;

if (!process.env.SESSION_SECRET) {
  console.error("Missing SESSION_SECRET in environment.");
  process.exit(1);
}

app.disable("x-powered-by");

app.use(helmet());

app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    credentials: true
  })
);

app.use(express.json({ limit: "1mb" }));

// General API rate limit
app.use(
  "/api",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 200,
    standardHeaders: "draft-8",
    legacyHeaders: false
  })
);

// Health check
app.get("/", (req, res) => {
  res.json({
    name: "TechHub Earning API",
    status: "ok"
  });
});

app.get("/api/health", async (req, res) => {
  try {
    const { checkDatabase } = require("./db");
    await checkDatabase();

    res.json({
      status: "ok",
      database: "connected"
    });
  } catch (error) {
    console.error("Database health check failed:", error.message);

    res.status(503).json({
      status: "error",
      database: "unavailable"
    });
  }
});

// Authentication routes
app.use("/api/auth", authRoutes);

// Admin management routes
// Owner-only access is enforced inside admin.js
app.use("/api/admin", adminRoutes);

// Unknown routes
app.use((req, res) => {
  res.status(404).json({
    error: "Route not found"
  });
});

// Central error handler
app.use((err, req, res, next) => {
  console.error("Server error:", err.message);

  if (res.headersSent) {
    return next(err);
  }

  res.status(500).json({
    error: "Internal server error"
  });
});

const server = app.listen(PORT, () => {
  console.log(`TechHub Earning API running on port ${PORT}`);
});

// Graceful shutdown
async function shutdown() {
  console.log("Shutting down TechHub Earning API...");

  server.close(async () => {
    try {
      const { pool } = require("./db");
      await pool.end();
      process.exit(0);
    } catch (error) {
      console.error("Shutdown error:", error.message);
      process.exit(1);
    }
  });
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
