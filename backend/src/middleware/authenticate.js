
const jwt = require("jsonwebtoken");
const { pool } = require("../db");

function getCookie(req, name) {
  const cookieHeader = req.headers.cookie || "";

  for (const item of cookieHeader.split(";")) {
    const separator = item.indexOf("=");

    if (separator === -1) continue;

    const key = item.slice(0, separator).trim();
    const value = item.slice(separator + 1).trim();

    if (key === name) {
      return value;
    }
  }

  return null;
}

async function authenticate(req, res, next) {
  const token = getCookie(req, "techhub_session");

  if (!token) {
    return res.status(401).json({
      error: "Please log in to continue."
    });
  }

  try {
    const decoded = jwt.verify(
      token,
      process.env.SESSION_SECRET,
      { algorithms: ["HS256"] }
    );

    const result = await pool.query(
      `SELECT id, name, email, mobile, role, status, referral_code
       FROM users
       WHERE id = $1
       LIMIT 1`,
      [decoded.sub]
    );

    if (
      result.rowCount === 0 ||
      result.rows[0].status !== "active"
    ) {
      return res.status(401).json({
        error: "Account is unavailable. Please contact support."
      });
    }

    req.user = result.rows[0];
    next();
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        error: "Your session expired. Please log in again."
      });
    }

    if (error.name === "JsonWebTokenError") {
      return res.status(401).json({
        error: "Invalid session. Please log in again."
      });
    }

    console.error("Authentication error:", error.message);

    return res.status(500).json({
      error: "Authentication service unavailable."
    });
  }
}

module.exports = { authenticate };
