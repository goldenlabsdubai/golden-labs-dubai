/**
 * Admins, bot_control, admin_settings in PostgreSQL. Used when getPool() is available.
 */
import { query, getPool } from "../config/postgres.js";

const DEFAULT_ADMIN_WALLET = "0xbdf976981242e8078b525e78784bf87c3b9da4ca";

export async function getAdminWalletsFromPg() {
  const p = getPool();
  if (!p) return null;
  const { rows } = await query("SELECT wallet FROM admins");
  let wallets = rows.map((r) => (r.wallet || "").toLowerCase()).filter((w) => w && w.startsWith("0x") && w.length === 42);
  if (wallets.length === 0) {
    await query("INSERT INTO admins (wallet, created_at, updated_at) VALUES ($1, NOW(), NOW()) ON CONFLICT (wallet) DO NOTHING", [DEFAULT_ADMIN_WALLET]);
    wallets = [DEFAULT_ADMIN_WALLET];
  }
  return wallets;
}

export async function setAdminNoncePg(wallet, nonce) {
  const p = getPool();
  if (!p) return;
  await query(
    `INSERT INTO admins (wallet, nonce, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (wallet) DO UPDATE SET nonce = $2, updated_at = NOW()`,
    [wallet.toLowerCase(), nonce]
  );
}

export async function getBotRunningStatePg() {
  const p = getPool();
  if (!p) return null;
  const { rows } = await query("SELECT running_by_bot_id FROM bot_control WHERE id = 'bots'");
  const raw = rows[0]?.running_by_bot_id;
  return raw && typeof raw === "object" ? raw : {};
}

export async function setBotRunningStatePg(runningByBotId) {
  const p = getPool();
  if (!p) return;
  await query(
    `INSERT INTO bot_control (id, running_by_bot_id, updated_at) VALUES ('bots', $1::jsonb, NOW())
     ON CONFLICT (id) DO UPDATE SET running_by_bot_id = $1::jsonb, updated_at = NOW()`,
    [JSON.stringify(runningByBotId && typeof runningByBotId === "object" ? runningByBotId : {})]
  );
}

export async function getAdminSettingsContractsPg() {
  const p = getPool();
  if (!p) return null;
  const { rows } = await query("SELECT addresses FROM admin_settings WHERE id = 'contracts'");
  const raw = rows[0]?.addresses;
  return raw && typeof raw === "object" ? raw : {};
}

export async function setAdminSettingsContractsPg(addresses, updatedBy) {
  const p = getPool();
  if (!p) return;
  await query(
    `INSERT INTO admin_settings (id, addresses, updated_at, updated_by) VALUES ('contracts', $1::jsonb, NOW(), $2)
     ON CONFLICT (id) DO UPDATE SET addresses = $1::jsonb, updated_at = NOW(), updated_by = $2`,
    [JSON.stringify(addresses && typeof addresses === "object" ? addresses : {}), updatedBy ?? null]
  );
}
