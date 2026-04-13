/**
 * Seed PostgreSQL `admins` table with the default admin wallet (if empty).
 * Run: npm run seed-admins
 * Requires: PGHOST, PGDATABASE, PGUSER, PGPASSWORD in backend/.env
 */
import "dotenv/config";
import { query, getPool } from "../src/config/postgres.js";

const DEFAULT_ADMIN_WALLET = "0xbdf976981242e8078b525e78784bf87c3b9da4ca";

async function main() {
  if (!getPool()) {
    console.error("PostgreSQL not configured. Set PGHOST, PGDATABASE, PGUSER, PGPASSWORD in backend/.env");
    process.exit(1);
  }
  await query(
    `INSERT INTO admins (wallet, created_at, updated_at) VALUES ($1, NOW(), NOW())
     ON CONFLICT (wallet) DO NOTHING`,
    [DEFAULT_ADMIN_WALLET]
  );
  console.log("Admin wallet ensured in PostgreSQL `admins`:", DEFAULT_ADMIN_WALLET);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
