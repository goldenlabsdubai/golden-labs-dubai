import { useEffect, useState, useCallback } from "react";
import { API } from "../config";

const POLL_MS = 30_000;

/** Keep in sync with `telegram-bot/alertFormat.js` (maintenance alert). */
const MAINTENANCE_MODAL_INTRO =
  "Dear Golden Labs community members — our platform will be available again shortly. Thank you for your patience while we complete scheduled maintenance.";

/** Same options as `telegram-bot/alertFormat.js` `formatMaintenanceRangeLocale` (Asia/Kolkata, no zone label). */
const MAINT_DISPLAY_LOCALE = "en-IN";
const MAINT_DISPLAY_TZ = "Asia/Kolkata";

function formatRange(startsAt, endsAt) {
  const opts = {
    timeZone: MAINT_DISPLAY_TZ,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  };
  const s = startsAt ? new Date(startsAt) : null;
  const e = endsAt ? new Date(endsAt) : null;
  if (!s || Number.isNaN(s.getTime())) return "";
  const sStr = s.toLocaleString(MAINT_DISPLAY_LOCALE, opts);
  if (!e || Number.isNaN(e.getTime())) return sStr;
  return `${sStr} → ${e.toLocaleString(MAINT_DISPLAY_LOCALE, opts)}`;
}

/**
 * Full-screen maintenance gate for the main app. Fetches public endpoint (no auth).
 */
export default function PlatformMaintenanceOverlay() {
  const [state, setState] = useState({ active: false });

  const poll = useCallback(async () => {
    const base = (API || "").replace(/\/+$/, "");
    if (!base) return;
    try {
      const r = await fetch(`${base}/public/platform-maintenance`, { credentials: "omit" });
      if (!r.ok) return;
      const j = await r.json();
      setState({
        active: Boolean(j.active),
        startsAt: j.startsAt || null,
        endsAt: j.endsAt || null,
        message: typeof j.message === "string" ? j.message : "",
        imageUrl: typeof j.imageUrl === "string" ? j.imageUrl.trim() : "",
      });
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => clearInterval(id);
  }, [poll]);

  useEffect(() => {
    if (!state.active) {
      document.body.style.overflow = "";
      return;
    }
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [state.active]);

  if (!state.active) return null;

  const range = formatRange(state.startsAt, state.endsAt);

  return (
    <div className="platform-maintenance-overlay" role="presentation">
      <div className="platform-maintenance-overlay__blur" aria-hidden="true" />
      <div className="platform-maintenance-overlay__modal" role="dialog" aria-modal="true" aria-labelledby="maint-title">
        <div className="platform-maintenance-overlay__accent-cap" aria-hidden="true" />
        <p className="platform-maintenance-overlay__step">Golden Labs</p>
        <h2 id="maint-title" className="platform-maintenance-overlay__title">
          Scheduled maintenance
        </h2>
        {state.imageUrl ? (
          <img
            className="platform-maintenance-overlay__image"
            src={state.imageUrl}
            alt=""
            decoding="async"
          />
        ) : null}
        <p className="platform-maintenance-overlay__intro">{MAINTENANCE_MODAL_INTRO}</p>
        {range ? (
          <div className="platform-maintenance-overlay__window">
            <span className="platform-maintenance-overlay__window-label">Maintenance window</span>
            <span className="platform-maintenance-overlay__times">{range}</span>
          </div>
        ) : null}
        {state.message ? (
          <p className="platform-maintenance-overlay__note">{state.message}</p>
        ) : null}
        <p className="platform-maintenance-overlay__footer">— Golden Labs</p>
      </div>
    </div>
  );
}
