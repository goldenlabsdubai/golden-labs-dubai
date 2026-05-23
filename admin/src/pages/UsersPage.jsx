import { useCallback, useEffect, useState } from "react";
import UsersTable from "../components/UsersTable";

const API = String(import.meta.env.VITE_API_URL || (import.meta.env.DEV ? "http://localhost:3001/api" : ""))
  .trim()
  .replace(/\/+$/, "");

const FILTER_MAP = {
  users: "all",
  "users-active": "active",
  "users-suspended": "suspended",
};

const PAGE_META = {
  users: {
    title: "Platform users",
    subtitle: "Full user data from the database — wallet, NFTs, referrals, and trading income.",
    empty: "No platform users found.",
  },
  "users-active": {
    title: "Active traders",
    subtitle: "Users with MINTED or ACTIVE_TRADER status (can use marketplace trading).",
    empty: "No active traders.",
  },
  "users-suspended": {
    title: "Suspended traders",
    subtitle: "Users with SUSPENDED status (must resubscribe).",
    empty: "No suspended users.",
  },
};

export default function UsersPage({ token, tabId = "users" }) {
  const filter = FILTER_MAP[tabId] || "all";
  const meta = PAGE_META[tabId] || PAGE_META.users;

  const [summary, setSummary] = useState({ totalUsers: 0, activeTraders: 0, suspendedTraders: 0 });
  const [referralLevels, setReferralLevels] = useState(1);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);

  const load = useCallback(
    async ({ silent = false } = {}) => {
      if (!token) return;
      if (!silent) setLoading(true);
      else setRefreshing(true);
      setError("");
      try {
        const r = await fetch(`${API}/admin/users/platform?filter=${encodeURIComponent(filter)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (r.status === 401) throw new Error("Session expired — sign in again.");
        if (!r.ok) {
          const payload = await r.json().catch(() => ({}));
          throw new Error(payload?.error || "Failed to load users");
        }
        const data = await r.json();
        setSummary(data.summary || { totalUsers: 0, activeTraders: 0, suspendedTraders: 0 });
        setReferralLevels(data.referralLevels ?? 1);
        setUsers(data.users || []);
        setLastUpdatedAt(data.serverTime || Date.now());
      } catch (e) {
        setError(e?.message || "Failed to load users");
      } finally {
        if (!silent) setLoading(false);
        if (silent) setRefreshing(false);
      }
    },
    [token, filter]
  );

  useEffect(() => {
    load();
  }, [load]);

  return (
    <section className="section section--users">
      <div className="section__row">
        <div>
          <h2 className="section__title">{meta.title}</h2>
          <p className="section__empty users-page__subtitle">{meta.subtitle}</p>
        </div>
        <div className="section__actions">
          <span className="section__empty">
            Last update: {lastUpdatedAt ? new Date(lastUpdatedAt).toLocaleTimeString() : "—"}
            {loading && !refreshing ? " · loading…" : ""}
          </span>
          <button type="button" className="btn btn--ghost" onClick={() => load({ silent: true })} disabled={refreshing}>
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      <div className="users-summary">
        <div className="users-summary__card">
          <span className="users-summary__label">Total users</span>
          <strong className="users-summary__value">{summary.totalUsers ?? 0}</strong>
        </div>
        <div className="users-summary__card users-summary__card--active">
          <span className="users-summary__label">Active traders</span>
          <strong className="users-summary__value">{summary.activeTraders ?? 0}</strong>
        </div>
        <div className="users-summary__card users-summary__card--suspended">
          <span className="users-summary__label">Suspended</span>
          <strong className="users-summary__value">{summary.suspendedTraders ?? 0}</strong>
        </div>
        <div className="users-summary__card users-summary__card--meta">
          <span className="users-summary__label">Showing</span>
          <strong className="users-summary__value">{users.length}</strong>
          <span className="users-summary__hint">in this view</span>
        </div>
      </div>

      {error && <p className="section__error">{error}</p>}

      {loading ? (
        <div className="users-skeleton" aria-busy="true" aria-label="Loading users">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="users-skeleton__card" />
          ))}
        </div>
      ) : (
        <UsersTable users={users} referralLevels={referralLevels} emptyMessage={meta.empty} />
      )}
    </section>
  );
}
