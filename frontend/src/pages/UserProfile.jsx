import { useState, useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { API, getAvatarUrl } from "../config";

/** Turn handle or full URL into clickable URL for X or Telegram. */
function normalizeUrl(value, type) {
  const s = (value || "").trim();
  if (!s) return "#";
  if (s.startsWith("http://") || s.startsWith("https://")) return s;
  let handle = s.replace(/^@/, "");
  if (type === "x") {
    handle = handle.replace(/^(https?:\/\/)?(www\.)?(x\.com|twitter\.com)\/?/i, "").split("/")[0] || handle;
    return `https://x.com/${handle}`;
  }
  if (type === "telegram") {
    handle = handle.replace(/^(https?:\/\/)?(www\.)?t\.me\/?/i, "").split("/")[0] || handle;
    return `https://t.me/${handle}`;
  }
  return s;
}

export default function UserProfile() {
  const { username: usernameParam } = useParams();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [avatarError, setAvatarError] = useState(false);

  const username = (usernameParam || "").trim().toLowerCase();

  useEffect(() => {
    if (!username) {
      setLoading(false);
      setError("Username required");
      return;
    }
    setLoading(true);
    setError("");
    fetch(`${API}/user/public/${encodeURIComponent(username)}`)
      .then((r) => {
        if (!r.ok) throw new Error(r.status === 404 ? "User not found" : "Failed to load profile");
        return r.json();
      })
      .then((data) => {
        setProfile(data);
      })
      .catch((e) => {
        setError(e.message || "Failed to load profile");
        setProfile(null);
      })
      .finally(() => setLoading(false));
  }, [username]);

  if (loading) {
    return (
      <div className="user-profile user-profile--loading">
        <header className="user-profile__nav">
          <Link to="/marketplace" className="user-profile__logo">Golden Labs</Link>
        </header>
        <div className="user-profile__content">
          <p className="user-profile__loading">Loading profile…</p>
        </div>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="user-profile">
        <header className="user-profile__nav">
          <Link to="/marketplace" className="user-profile__logo">Golden Labs</Link>
        </header>
        <div className="user-profile__content">
          <p className="user-profile__error">{error || "User not found"}</p>
          <Link to="/marketplace" className="user-profile__back">Back to Marketplace</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="user-profile">
      <header className="user-profile__nav">
        <Link to="/marketplace" className="user-profile__logo">Golden Labs</Link>
        <nav className="user-profile__links">
          <Link to="/marketplace">Marketplace</Link>
          <Link to="/leaderboard">Leaderboard</Link>
          <Link to="/dashboard">My Dashboard</Link>
        </nav>
      </header>

      <div className="user-profile__card">
        <div className="user-profile__avatar-wrap">
          {profile.avatar && !avatarError ? (
            <img
              src={getAvatarUrl(profile.avatar)}
              alt=""
              className="user-profile__avatar"
              onError={() => setAvatarError(true)}
            />
          ) : (
            <div className="user-profile__avatar-placeholder" />
          )}
        </div>
        <h1 className="user-profile__name">
          {profile.name || profile.username || "Unnamed"}
        </h1>
        <p className="user-profile__username">@{profile.username}</p>
        {(profile.xUrl || profile.telegramUrl) && (
          <div className="user-profile__social-wrap">
            <p className="user-profile__social-label">Find me on</p>
            <div className="user-profile__social">
              {profile.xUrl && (
                <a href={normalizeUrl(profile.xUrl, "x")} target="_blank" rel="noopener noreferrer" className="user-profile__social-link" aria-label="X (Twitter)">
                  <svg className="user-profile__social-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                  </svg>
                </a>
              )}
              {profile.telegramUrl && (
                <a href={normalizeUrl(profile.telegramUrl, "telegram")} target="_blank" rel="noopener noreferrer" className="user-profile__social-link" aria-label="Telegram">
                  <svg className="user-profile__social-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                    <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
                  </svg>
                </a>
              )}
            </div>
          </div>
        )}
        <div className="user-profile__stats">
          <span className="user-profile__stat">
            <strong>{profile.totalTrades ?? 0}</strong> trades
          </span>
          {profile.createdAt && (
            <span className="user-profile__stat">
              Member since {new Date(profile.createdAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}
            </span>
          )}
        </div>
        <Link to="/marketplace" className="user-profile__back">View Marketplace</Link>
      </div>

      <footer className="user-profile__footer">
        <Link to="/marketplace" className="user-profile__footer-logo">Golden Labs</Link>
        <p className="user-profile__footer-copy">© {new Date().getFullYear()} Golden Labs</p>
      </footer>
    </div>
  );
}
