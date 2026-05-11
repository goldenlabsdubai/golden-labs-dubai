/**
 * When scheduled maintenance has a finite window and current time is past endsAt,
 * persist enabled=false and send Telegram maintenance_resumed (same as admin "End maintenance").
 * Public overlay already hides via isPlatformMaintenanceActive; this aligns DB + admin UI + Telegram.
 */
import { getPool } from "../config/postgres.js";
import * as AdminPg from "./adminPostgres.js";
import {
  PLATFORM_MAINTENANCE_SETTINGS_ID,
  normalizeMaintenanceFromDb,
} from "./platformMaintenance.js";
import { notifyActivity } from "./telegramNotify.js";

const UPDATED_BY = "system:auto-end-window";

export async function runPlatformMaintenanceAutoEndOnce() {
  if (!getPool()) return;
  try {
    const stored = await AdminPg.getAdminSettingsByIdPg(PLATFORM_MAINTENANCE_SETTINGS_ID);
    const m = normalizeMaintenanceFromDb(stored || {});
    if (!m.enabled) return;

    const s = m.startsAt ? Date.parse(m.startsAt) : NaN;
    const e = m.endsAt ? Date.parse(m.endsAt) : NaN;
    if (!Number.isFinite(s) || !Number.isFinite(e)) return;
    if (Date.now() <= e) return;

    const nextPayload = {
      enabled: false,
      startsAt: m.startsAt,
      endsAt: m.endsAt,
      message: m.message || "",
      imageUrl: m.imageUrl || "",
    };
    await AdminPg.setAdminSettingsByIdPg(PLATFORM_MAINTENANCE_SETTINGS_ID, nextPayload, UPDATED_BY);
    console.log("[maintenance] Scheduled window ended — disabled in DB (auto); Telegram resumed alert...");
    notifyActivity("maintenance_resumed", {}).catch((err) =>
      console.warn("[telegram] maintenance_resumed (auto-end):", err?.message || err)
    );
  } catch (e) {
    console.warn("[maintenance] auto-end:", e?.message || e);
  }
}

export function startPlatformMaintenanceAutoEndScheduler() {
  if (!getPool()) return;
  const ms = Math.max(15_000, Math.min(Number(process.env.MAINTENANCE_AUTO_END_MS) || 60_000, 300_000));
  setTimeout(() => {
    runPlatformMaintenanceAutoEndOnce().catch(() => {});
  }, 5_000);
  setInterval(() => {
    runPlatformMaintenanceAutoEndOnce().catch(() => {});
  }, ms);
  console.log(`[maintenance] Auto-end scheduler every ${ms}ms (past endsAt → disable + Telegram resumed)`);
}
