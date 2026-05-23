import { useMemo, useState } from "react";
import { formatUsdtDisplay } from "../utils/usdtFormat";

function shortAddress(addr) {
  if (!addr || addr.length < 12) return addr || "—";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function stateBadgeClass(state) {
  const s = String(state || "").toUpperCase();
  if (s === "SUSPENDED") return "users-badge users-badge--suspended";
  if (s === "MINTED" || s === "ACTIVE_TRADER") return "users-badge users-badge--active";
  if (s === "SUBSCRIBED") return "users-badge users-badge--subscribed";
  return "users-badge";
}

function userInitial(u) {
  const name = String(u?.username || "").trim();
  if (name) return name.charAt(0).toUpperCase();
  const w = String(u?.wallet || "");
  return w.startsWith("0x") ? w.charAt(2).toUpperCase() : "?";
}

function formatJoined(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return "—";
  }
}

function totalReferralMembers(u, levels) {
  let n = 0;
  for (let i = 1; i <= levels; i++) {
    n += Number(u.referralCounts?.[`l${i}`] ?? 0) || 0;
  }
  return n;
}

function referralRows(u, levels) {
  const rows = [];
  for (let i = 1; i <= levels; i++) {
    const count = Number(u.referralCounts?.[`l${i}`] ?? 0) || 0;
    const earn = formatUsdtDisplay(u.referralEarningsUsdt?.[`l${i}`]);
    const earnNum = Number.parseFloat(earn) || 0;
    if (count > 0 || earnNum > 0) {
      rows.push({ level: i, count, earn });
    }
  }
  return rows;
}

function NftChips({ ids }) {
  const list = Array.isArray(ids) ? ids : [];
  if (!list.length) return <span className="user-card__muted">No NFTs held</span>;
  const visible = list.slice(0, 8);
  const rest = list.length - visible.length;
  return (
    <div className="user-card__chips">
      {visible.map((id) => (
        <span key={id} className="user-card__chip" title={`Token #${id}`}>
          #{id}
        </span>
      ))}
      {rest > 0 ? <span className="user-card__chip user-card__chip--more">+{rest}</span> : null}
    </div>
  );
}

function UserCard({ user, levels, expanded, onToggle }) {
  const refRows = referralRows(user, levels);
  const refMembers = totalReferralMembers(user, levels);

  const copyWallet = async () => {
    if (!user.wallet) return;
    try {
      await navigator.clipboard.writeText(user.wallet);
    } catch {
      /* ignore */
    }
  };

  return (
    <article className={`user-card${expanded ? " user-card--expanded" : ""}`}>
      <div className="user-card__surface">
        <div className="user-card__head">
          <div className="user-card__identity">
            <span className="user-card__avatar" aria-hidden="true">
              {userInitial(user)}
            </span>
            <div className="user-card__who">
              <div className="user-card__name-row">
                <h3 className="user-card__name">{user.username ? `@${user.username}` : "Unnamed user"}</h3>
                <span className={stateBadgeClass(user.state)}>{user.state || "—"}</span>
              </div>
              <div className="user-card__wallet-row">
                <code className="user-card__wallet" title={user.wallet}>
                  {shortAddress(user.wallet)}
                </code>
                <button type="button" className="user-card__copy" onClick={copyWallet} aria-label="Copy wallet address">
                  Copy
                </button>
              </div>
            </div>
          </div>
          <button type="button" className="user-card__toggle" aria-expanded={expanded} onClick={onToggle}>
            {expanded ? "Hide" : "Details"}
          </button>
        </div>

        <div className="user-card__stats">
          <div className="user-stat">
            <span className="user-stat__label">NFTs</span>
            <strong className="user-stat__value">{user.nftCount ?? 0}</strong>
          </div>
          <div className="user-stat">
            <span className="user-stat__label">Trades</span>
            <strong className="user-stat__value">{user.totalTrades ?? 0}</strong>
          </div>
          <div className="user-stat user-stat--gold">
            <span className="user-stat__label">Trading income</span>
            <strong className="user-stat__value">{formatUsdtDisplay(user.tradingIncomeUsdt)}</strong>
            <span className="user-stat__unit">USDT</span>
          </div>
          <div className="user-stat">
            <span className="user-stat__label">Referrals</span>
            <strong className="user-stat__value">{refMembers}</strong>
            <span className="user-stat__unit">members</span>
          </div>
          <div className="user-stat user-stat--gold">
            <span className="user-stat__label">Ref income</span>
            <strong className="user-stat__value">{formatUsdtDisplay(user.referralEarningsTotalUsdt)}</strong>
            <span className="user-stat__unit">USDT</span>
          </div>
          <div className="user-stat">
            <span className="user-stat__label">Joined</span>
            <strong className="user-stat__value user-stat__value--date">{formatJoined(user.createdAt)}</strong>
          </div>
        </div>

        {expanded ? (
          <div className="user-card__details">
            <div className="user-card__panel">
              <h4 className="user-card__panel-title">NFT holdings</h4>
              <NftChips ids={user.nftHoldings} />
            </div>
            <div className="user-card__panel">
              <h4 className="user-card__panel-title">Referral breakdown</h4>
              {refRows.length ? (
                <div className="ref-grid">
                  <div className="ref-grid__head">
                    <span>Level</span>
                    <span>Members</span>
                    <span>Earned (USDT)</span>
                  </div>
                  {refRows.map((row) => (
                    <div className="ref-grid__row" key={`${user.wallet}-L${row.level}`}>
                      <span className="ref-grid__level">L{row.level}</span>
                      <span className="ref-grid__count">{row.count}</span>
                      <span className="ref-grid__earn">{row.earn}</span>
                    </div>
                  ))}
                  <div className="ref-grid__row ref-grid__row--total">
                    <span>Total</span>
                    <span>{refMembers}</span>
                    <span>{formatUsdtDisplay(user.referralEarningsTotalUsdt)}</span>
                  </div>
                </div>
              ) : (
                <p className="user-card__muted">No referral activity recorded.</p>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </article>
  );
}

export default function UsersTable({ users, referralLevels, emptyMessage }) {
  const levels = Math.max(1, Math.min(10, Number(referralLevels) || 1));
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(() => new Set());

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users || [];
    return (users || []).filter((u) => {
      const username = String(u.username || "").toLowerCase();
      const wallet = String(u.wallet || "").toLowerCase();
      const state = String(u.state || "").toLowerCase();
      return username.includes(q) || wallet.includes(q) || state.includes(q);
    });
  }, [users, search]);

  const toggleExpanded = (key) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (!users?.length) {
    return <p className="section__empty users-empty">{emptyMessage || "No users in this view."}</p>;
  }

  return (
    <div className="users-modern">
      <div className="users-toolbar">
        <label className="users-search">
          <span className="users-search__icon" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3-3" strokeLinecap="round" />
            </svg>
          </span>
          <input
            type="search"
            className="users-search__input"
            placeholder="Search username, wallet, or status…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <p className="users-toolbar__meta">
          {filtered.length} of {users.length} users
        </p>
      </div>

      {filtered.length === 0 ? (
        <p className="section__empty users-empty">No users match your search.</p>
      ) : (
        <div className="users-list">
          {filtered.map((u) => {
            const key = u.id || u.wallet;
            return (
              <UserCard
                key={key}
                user={u}
                levels={levels}
                expanded={expanded.has(key)}
                onToggle={() => toggleExpanded(key)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
