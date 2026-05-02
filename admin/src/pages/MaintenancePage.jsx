import { useCallback, useEffect, useState } from "react";
import MaintenanceDatetimeField from "../components/MaintenanceDatetimeField.jsx";
import { isoToDatetimeLocalIst, datetimeLocalIstToIso } from "../utils/maintenanceIst.js";

function normalizeApiBase(url) {
  return String(url || "")
    .trim()
    .replace(/\/+$/, "");
}

const API = normalizeApiBase(
  import.meta.env.VITE_API_URL?.trim() || (import.meta.env.DEV ? "http://localhost:3001/api" : "")
);

export default function MaintenancePage({ token }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [startsLocal, setStartsLocal] = useState("");
  const [endsLocal, setEndsLocal] = useState("");
  const [message, setMessage] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [usersBlockedNow, setUsersBlockedNow] = useState(false);
  /** Last saved form snapshot (server); dirty = differs from current fields */
  const [baseline, setBaseline] = useState({
    startsLocal: "",
    endsLocal: "",
    message: "",
  });

  const isDirty =
    startsLocal !== baseline.startsLocal ||
    endsLocal !== baseline.endsLocal ||
    message !== baseline.message;

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const r = await fetch(`${API}/admin/platform-maintenance`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${r.status}`);
      }
      const d = await r.json();
      setEnabled(Boolean(d.enabled));
      const s = isoToDatetimeLocalIst(d.startsAt);
      const e = isoToDatetimeLocalIst(d.endsAt);
      const msg = typeof d.message === "string" ? d.message : "";
      setStartsLocal(s);
      setEndsLocal(e);
      setMessage(msg);
      setBaseline({ startsLocal: s, endsLocal: e, message: msg });
      setUsersBlockedNow(Boolean(d.usersBlockedNow));
    } catch (e) {
      setError(e?.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (nextEnabled) => {
    if (!token) return;
    setSaving(true);
    setError("");
    try {
      const startsAt = datetimeLocalIstToIso(startsLocal);
      const endsAt = datetimeLocalIstToIso(endsLocal);
      const r = await fetch(`${API}/admin/platform-maintenance`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          enabled: nextEnabled,
          startsAt,
          endsAt,
          message: message.trim(),
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setEnabled(Boolean(j.enabled));
      setUsersBlockedNow(Boolean(j.usersBlockedNow));
      const s = isoToDatetimeLocalIst(j.startsAt);
      const e = isoToDatetimeLocalIst(j.endsAt);
      const msg = typeof j.message === "string" ? j.message : "";
      setStartsLocal(s);
      setEndsLocal(e);
      setMessage(msg);
      setBaseline({ startsLocal: s, endsLocal: e, message: msg });
    } catch (e) {
      setError(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="section maintenance-page">
      <div className="section__row">
        <h2 className="section__title">Platform maintenance</h2>
      </div>
      {error && <p className="section__error">{error}</p>}
      {loading ? (
        <p className="section__empty">Loading…</p>
      ) : (
        <article className="maintenance-card">
          <p className="maintenance-card__step">Golden Labs</p>
          <h3 className="maintenance-card__title">Scheduled downtime</h3>
          <p className="maintenance-card__status">
            Status: <strong>{enabled ? "Scheduled / enabled" : "Off"}</strong>
            {enabled ? (
              <>
                {" "}
                · Users blocked right now: <strong>{usersBlockedNow ? "Yes" : "No"}</strong>
                <span className="maintenance-card__hint">
                  (only while the current time is inside the window)
                </span>
              </>
            ) : null}
          </p>
          <MaintenanceDatetimeField id="maint-start" label="Start" value={startsLocal} onChange={setStartsLocal} />
          <MaintenanceDatetimeField id="maint-end" label="End" value={endsLocal} onChange={setEndsLocal} />
          <label className="maintenance-field">
            <span className="maintenance-field__label">Optional note (shown in the live modal)</span>
            <textarea
              className="maintenance-field__textarea"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="e.g. We’re upgrading the trading engine…"
            />
          </label>
          <div className="maintenance-card__actions">
            <button
              type="button"
              className={isDirty && !saving && !loading ? "btn btn--gold" : "btn btn--ghost"}
              disabled={!isDirty || saving || loading}
              onClick={() => save(true)}
            >
              {saving ? "Saving…" : isDirty ? "Save & enable window" : "No changes to save"}
            </button>
            <button
              type="button"
              className={
                !isDirty && !saving && !loading && enabled ? "btn btn--danger" : "btn btn--ghost"
              }
              disabled={isDirty || saving || loading || !enabled}
              onClick={() => save(false)}
            >
              End maintenance (disable)
            </button>
          </div>
        </article>
      )}
    </section>
  );
}
