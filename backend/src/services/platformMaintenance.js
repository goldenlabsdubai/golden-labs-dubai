/**
 * Scheduled platform maintenance — stored in admin_settings (id platform_maintenance).
 * Public site blocks UX only while `enabled` and current time is within [startsAt, endsAt] (or always if enabled with no valid window — see isPlatformMaintenanceActive).
 */
export const PLATFORM_MAINTENANCE_SETTINGS_ID = "platform_maintenance";

function normalizeMaintenanceImageUrl(raw) {
  if (typeof raw !== "string") return "";
  const t = raw.trim().slice(0, 2048);
  if (!t) return "";
  if (!/^https?:\/\/.+/i.test(t)) return "";
  return t;
}

export function normalizeMaintenancePayload(body) {
  const b = body && typeof body === "object" ? body : {};
  return {
    enabled: Boolean(b.enabled),
    startsAt: typeof b.startsAt === "string" ? b.startsAt.trim() : "",
    endsAt: typeof b.endsAt === "string" ? b.endsAt.trim() : "",
    message: typeof b.message === "string" ? b.message.trim().slice(0, 2000) : "",
    imageUrl: normalizeMaintenanceImageUrl(b.imageUrl),
  };
}

export function normalizeMaintenanceFromDb(data) {
  const d = data && typeof data === "object" ? data : {};
  return {
    enabled: Boolean(d.enabled),
    startsAt: typeof d.startsAt === "string" ? d.startsAt : "",
    endsAt: typeof d.endsAt === "string" ? d.endsAt : "",
    message: typeof d.message === "string" ? d.message : "",
    imageUrl: normalizeMaintenanceImageUrl(d.imageUrl),
  };
}

/** True when users should see the full-screen maintenance overlay. */
export function isPlatformMaintenanceActive(raw) {
  const m = normalizeMaintenanceFromDb(raw);
  if (!m.enabled) return false;
  const s = m.startsAt ? Date.parse(m.startsAt) : NaN;
  const e = m.endsAt ? Date.parse(m.endsAt) : NaN;
  const now = Date.now();
  const hasStart = Number.isFinite(s);
  const hasEnd = Number.isFinite(e);
  if (!hasStart && !hasEnd) return true;
  if (hasStart && !hasEnd) return now >= s;
  if (!hasStart && hasEnd) return now <= e;
  return now >= s && now <= e;
}

/** Response for GET /api/public/platform-maintenance (no secrets). */
export function publicMaintenanceDto(raw) {
  const m = normalizeMaintenanceFromDb(raw);
  if (!isPlatformMaintenanceActive(m)) {
    return { active: false };
  }
  return {
    active: true,
    startsAt: m.startsAt || null,
    endsAt: m.endsAt || null,
    message: m.message || "",
    imageUrl: m.imageUrl || "",
  };
}
