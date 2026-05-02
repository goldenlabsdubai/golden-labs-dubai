/** Asia/Kolkata wall time ↔ API ISO (shared by maintenance page + datetime field). */

const PAD = (n) => String(n).padStart(2, "0");

export function isoToDatetimeLocalIst(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t)?.value || "";
  const y = get("year");
  const mo = get("month");
  const da = get("day");
  const h = get("hour");
  const mi = get("minute");
  if (!y || !mo || !da) return "";
  return `${y}-${mo}-${da}T${h || "00"}:${mi || "00"}`;
}

export function datetimeLocalIstToIso(local) {
  if (!local) return "";
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) return "";
  const [, ys, mos, ds, hs, mis] = m;
  const d = new Date(`${ys}-${mos}-${ds}T${hs}:${mis}:00+05:30`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString();
}

export function parseIstLocalString(str) {
  const m = str?.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) return null;
  return { y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5] };
}

export function formatIstLocalString(parts) {
  const { y, mo, d, h, mi } = parts;
  return `${y}-${PAD(mo)}-${PAD(d)}T${PAD(h)}:${PAD(mi)}`;
}

export function istNowLocalString() {
  return isoToDatetimeLocalIst(new Date().toISOString());
}
