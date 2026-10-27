
const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { pool } = require("./db");
const { authenticate } = require("./middleware/authenticate");

const router = express.Router();

const COOKIE_NAME = "techhub_session";
const SESSION_SECONDS = 30 * 24 * 60 * 60;

function createReferralCode() {
  return crypto.randomBytes(6).toString("hex").toUpperCase();
}

function setAuthCookie(res, userId) {
  const token = jwt.sign(
    { sub: String(userId) },
    process.env.SESSION_SECRET,
    {
      algorithm: "HS256",
      expiresIn: SESSION_SECONDS
    }
  );

  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_SECONDS * 1000
  });
}

function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/"
  });
}

router.post("/register", async (req, res) => {
  const name = typeof req.body.name === "string"
    ? req.body.name.trim()
    : "";

  const email = typeof req.body.email === "string"
    ? req.body.email.trim().toLowerCase()
    : "";

  const mobile = typeof req.body.mobile === "string"
    ? req.body.mobile.trim()
    : "";

  const password = typeof req.body.password === "string"
    ? req.body.password
    : "";

  const referralCode = typeof req.body.referralCode === "string"
    ? req.body.referralCode.trim().toUpperCase()
    : "";

  if (name.length < 2 || name.length > 100) {
    return res.status(400).json({
      error: "Name must be between 2 and 100 characters."
    });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      email.length > 254) {
    return res.status(400).json({
      error: "Enter a valid email address."
    });
  }

  if (!/^\+?[0-9]{10,15}$/.test(mobile)) {
    return res.status(400).json({
      error: "Enter a valid mobile number."
    });
  }

  if (password.length < 10 || password.length > 72) {
    return res.status(400).json({
      error: "Password must be between 10 and 72 characters."
    });
  }

  let client;

  try {
    client = await pool.connect();
    await client.query("BEGIN");

    const duplicate = await client.query(
      `SELECT id FROM users
       WHERE email = $1 OR mobile = $2
       LIMIT 1`,
      [email, mobile]
    );

    if (duplicate.rowCount > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        error: "Email or mobile number is already registered."
      });
    }

    let referrerId = null;

    if (referralCode) {
      const referrer = await client.query(
        `SELECT id FROM users
         WHERE referral_code = $1 AND status = 'active'
         LIMIT 1`,
        [referralCode]
      );

      if (referrer.rowCount === 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          error: "Referral code is invalid."
        });
      }

      referrerId = referrer.rows[0].id;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    let user = null;

    for (let attempt = 0; attempt < 5; attempt++) {
      const code = createReferralCode();

      try {
        const result = await client.query(
          `INSERT INTO users
             (name, email, mobile, password_hash,
              role, status, referral_code, referred_by)
           VALUES ($1, $2, $3, $4, 'user', 'active', $5, $6)
           RETURNING id, name, email, mobile, referral_code`,
          [name, email, mobile, passwordHash, code, referrerId]
        );

        user = result.rows[0];
        break;
      } catch (error) {
        if (error.code !== "23505") throw error;

        const existing = await client.query(
          `SELECT id FROM users
           WHERE email = $1 OR mobile = $2
           LIMIT 1`,
          [email, mobile]
        );

        if (existing.rowCount > 0) {
          await client.query("ROLLBACK");
          return res.status(409).json({
            error: "Email or mobile number is already registered."
          });
        }

        if (attempt === 4) throw error;
      }
    }

    if (!user) throw new Error("Could not create user.");

    if (referrerId !== null) {
      await client.query(
        `INSERT INTO referrals
          (referrer_id, referred_user_id, status)
         VALUES ($1, $2, 'pending')`,
        [referrerId, user.id]
      );
    }

    await client.query("COMMIT");
    setAuthCookie(res, user.id);

    return res.status(201).json({
      message: "Registration successful.",
      user
    });
  } catch (error) {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch (_) {}
    }

    console.error("Registration error:", error.message);

    return res.status(500).json({
      error: "Registration failed. Please try again."
    });
  } finally {
    if (client) client.release();
  }
});

router.post("/login", async (req, res) => {
  const email = typeof req.body.email === "string"
    ? req.body.email.trim().toLowerCase()
    : "";

  const password = typeof req.body.password === "string"
    ? req.body.password
    : "";

  if (!email || !password) {
    return res.status(400).json({
      error: "Email and password are required."
    });
  }

  try {
    const result = await pool.query(
      `SELECT id, name, email, mobile, password_hash,
              role, status, referral_code
       FROM users
       WHERE email = $1
       LIMIT 1`,
      [email]
    );

    if (result.rowCount === 0) {
      return res.status(401).json({
        error: "Invalid email or password."
      });
    }

    const user = result.rows[0];

    const passwordMatches = await bcrypt.compare(
      password,
      user.password_hash
    );

    if (!passwordMatches || user.status !== "active") {
      return res.status(401).json({
        error: "Invalid email or password."
      });
    }

    setAuthCookie(res, user.id);

    delete user.password_hash;

    return res.json({
      message: "Login successful.",
      user
    });
  } catch (error) {
    console.error("Login error:", error.message);

    return res.status(500).json({
      error: "Login service unavailable."
    });
  }
});

router.post("/logout", (req, res) => {
  clearAuthCookie(res);

  return res.json({
    message: "Logged out successfully."
  });
});

router.get("/me", authenticate, (req, res) => {
  return res.json({
    user: req.user
  });
});

module.exports = router;
