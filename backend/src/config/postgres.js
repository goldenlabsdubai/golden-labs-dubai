/**
 * PostgreSQL (RDS) connection pool for Golden Labs.
 * Set PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD in .env.
 * When not set, getPool() returns null (backend keeps using Firestore).
 */
import pg from "pg";

const { Pool } = pg;

let pool = null;

export function getPool() {
  if (pool) return pool;
  const host = process.env.PGHOST?.trim();
  const port = process.env.PGPORT != null ? parseInt(process.env.PGPORT, 10) : 5432;
  const database = process.env.PGDATABASE?.trim();
  const user = process.env.PGUSER?.trim();
  const password = process.env.PGPASSWORD != null ? String(process.env.PGPASSWORD) : undefined;
  if (!host || !database || !user) {
    return null;
  }
  pool = new Pool({
    host,
    port: Number.isFinite(port) ? port : 5432,
    database,
    user,
    password: password || undefined,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });
  pool.on("error", (err) => {
    console.warn("PostgreSQL pool error:", err?.message || err);
  });
  return pool;
}

/** Run a query. Returns rows or throws. Use when you have a pool (PostgreSQL enabled). */
export async function query(text, params = []) {
  const p = getPool();
  if (!p) throw new Error("PostgreSQL not configured (set PGHOST, PGDATABASE, PGUSER in .env)");
  const result = await p.query(text, params);
  return result;
}

/** Get a client from the pool for transactions. Remember to release when done. */
export async function getClient() {
  const p = getPool();
  if (!p) throw new Error("PostgreSQL not configured");
  return p.connect();
}

/** Check if PostgreSQL is configured and reachable. */
export async function isPgConfigured() {
  const p = getPool();
  if (!p) return false;
  try {
    await p.query("SELECT 1");
    return true;
  } catch (_) {
    return false;
  }
}
