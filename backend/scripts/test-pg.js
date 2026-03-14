/**
 * Test PostgreSQL connection. Run from backend dir: node scripts/test-pg.js
 * Load .env first so PGHOST, PGDATABASE, PGUSER, PGPASSWORD are set.
 */
import "dotenv/config";
import { getPool } from "../src/config/postgres.js";

console.log("Connecting to PostgreSQL...");
const pool = getPool();
if (!pool) {
  console.log("PostgreSQL: Not configured (missing PGHOST, PGDATABASE, or PGUSER in .env)");
  process.exit(1);
}
try {
  await pool.query("SELECT 1");
  console.log("PostgreSQL: OK");
  process.exit(0);
} catch (err) {
  console.log("PostgreSQL: Unreachable");
  console.error("Error:", err.message || err);
  process.exit(1);
}
