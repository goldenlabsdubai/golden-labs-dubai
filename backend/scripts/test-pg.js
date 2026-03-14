/**
 * Test PostgreSQL connection. Run from backend dir: node scripts/test-pg.js
 * Load .env first so PGHOST, PGDATABASE, PGUSER, PGPASSWORD are set.
 */
import "dotenv/config";
import { isPgConfigured, getPool } from "../src/config/postgres.js";

console.log("Connecting to PostgreSQL...");
const pool = getPool();
if (!pool) {
  console.log("PostgreSQL: Not configured (missing PGHOST, PGDATABASE, or PGUSER in .env)");
  process.exit(1);
}
const ok = await isPgConfigured();
console.log(ok ? "PostgreSQL: OK" : "PostgreSQL: Unreachable (check RDS, security group, .env)");
process.exit(ok ? 0 : 1);
