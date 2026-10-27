
require("dotenv").config();

const bcrypt = require("bcryptjs");
const { pool } = require("./db");

async function setupOwner() {
  const email = process.env.OWNER_EMAIL?.trim().toLowerCase();
  const password = process.env.OWNER_PASSWORD;

  if (!email || !password || password.length < 12) {
    throw new Error(
      "Set OWNER_EMAIL and a strong OWNER_PASSWORD (at least 12 characters) in the private environment."
    );
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const existingOwner = await client.query(
      "SELECT id FROM users WHERE role = 'owner' LIMIT 1 FOR UPDATE"
    );

    if (existingOwner.rowCount > 0) {
      throw new Error(
        "An owner already exists. This script will not change existing owner accounts."
      );
    }

    const existingEmail = await client.query(
      "SELECT id FROM users WHERE email = $1 LIMIT 1",
      [email]
    );

    if (existingEmail.rowCount > 0) {
      throw new Error(
        "This email is already registered. Resolve the account securely before owner setup."
      );
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const result = await client.query(
      `INSERT INTO users
       (name, email, mobile, password_hash, role, status)
       VALUES ($1, $2, $3, $4, 'owner', 'active')
       RETURNING id, name, email, role, status`,
      [
        "TechHub Owner",
        email,
        `owner-${Date.now()}`,
        passwordHash
      ]
    );

    await client.query(
      `INSERT INTO audit_logs
       (actor_id, action, target_type, target_id, details)
       VALUES ($1, 'owner_created', 'user', $1, '{}'::jsonb)`,
      [result.rows[0].id]
    );

    await client.query("COMMIT");

    console.log("Owner account created:", result.rows[0].email);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

setupOwner().catch((error) => {
  console.error("Owner setup failed:", error.message);
  process.exitCode = 1;
});
