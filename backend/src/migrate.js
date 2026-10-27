
require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { query, closeDatabase } = require("./db");

async function migrate() {
  const schemaPath = path.join(__dirname, "schema.sql");
  const schema = fs.readFileSync(schemaPath, "utf8");

  try {
    console.log("Applying TechHub Earning database schema...");

    await query("BEGIN");

    try {
      await query(schema);
      await query("COMMIT");
    } catch (error) {
      await query("ROLLBACK");
      throw error;
    }

    console.log("Database schema applied successfully.");
  } finally {
    await closeDatabase();
  }
}

migrate().catch((error) => {
  console.error("Database migration failed:", error.message);
  process.exitCode = 1;
});
