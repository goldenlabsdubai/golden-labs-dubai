import { useEffect, useState } from "react";
import { GOLDEN_LABS_LOGO } from "../constants/brand";

const NAV_GROUPS = [
  {
    label: "Operations",
    items: [
      { id: "bots", label: "Bots", short: "Bots" },
      { id: "maintenance", label: "Maintenance", short: "Maint." },
      { id: "contracts", label: "Contracts", short: "Contracts" },
    ],
  },
  {
    label: "Platform users",
    items: [
      { id: "users", label: "All users", short: "All" },
      { id: "users-active", label: "Active traders", short: "Active" },
      { id: "users-suspended", label: "Suspended", short: "Suspended" },
    ],
  },
];

function NavIcon({ name }) {
  const common = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, "aria-hidden": true };
  if (name === "bots") {
    return (
      <svg {...common}>
        <rect x="4" y="8" width="16" height="12" rx="2" />
        <path d="M9 8V5M15 8V5M8 14h.01M16 14h.01M12 14h.01" strokeLinecap="round" />
      </svg>
    );
  }
  if (name === "maintenance") {
    return (
      <svg {...common}>
        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
      </svg>
    );
  }
  if (name === "contracts") {
    return (
      <svg {...common}>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6M8 13h8M8 17h5" strokeLinecap="round" />
      </svg>
    );
  }
  if (name === "users") {
    return (
      <svg {...common}>
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    );
  }
  if (name === "active") {
    return (
      <svg {...common}>
        <path d="M22 12h-4l-3 9L9 3l-3 9H2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="10" />
      <path d="M8 12h8" strokeLinecap="round" />
    </svg>
  );
}

function iconForTab(id) {
  if (id === "bots") return "bots";
  if (id === "maintenance") return "maintenance";
  if (id === "contracts") return "contracts";
  if (id === "users") return "users";
  if (id === "users-active") return "active";
  return "suspended";
}

export default function AdminShell({ activeTab, onNavigate, wallet, onLogout, wide, children }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [activeTab]);

  useEffect(() => {
    if (!mobileOpen) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  const activeLabel =
    NAV_GROUPS.flatMap((g) => g.items).find((i) => i.id === activeTab)?.label || "Dashboard";

  return (
    <div className={`admin-shell${wide ? " admin-shell--wide" : ""}`}>
      <div className="admin-shell__bg" aria-hidden="true" />

      {mobileOpen ? (
        <button type="button" className="admin-shell__backdrop" aria-label="Close menu" onClick={() => setMobileOpen(false)} />
      ) : null}

      <aside className={`admin-shell__sidebar${mobileOpen ? " admin-shell__sidebar--open" : ""}`}>
        <div className="admin-shell__brand">
          <img className="admin-shell__brand-logo" src={GOLDEN_LABS_LOGO} alt="Golden Labs" width={44} height={44} />
          <div>
            <p className="admin-shell__brand-title">Golden Labs</p>
            <p className="admin-shell__brand-sub">Admin console</p>
          </div>
        </div>

        <nav className="admin-shell__nav" aria-label="Admin navigation">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="admin-shell__nav-group">
              <p className="admin-shell__nav-label">{group.label}</p>
              <ul className="admin-shell__nav-list">
                {group.items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={`admin-shell__nav-item${activeTab === item.id ? " admin-shell__nav-item--active" : ""}`}
                      onClick={() => onNavigate(item.id)}
                    >
                      <span className="admin-shell__nav-icon">
                        <NavIcon name={iconForTab(item.id)} />
                      </span>
                      <span className="admin-shell__nav-text">{item.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="admin-shell__sidebar-foot">
          <p className="admin-shell__foot-label">Signed in</p>
          <p className="admin-shell__foot-wallet" title={wallet}>
            {wallet ? `${wallet.slice(0, 8)}…${wallet.slice(-6)}` : "—"}
          </p>
        </div>
      </aside>

      <div className="admin-shell__main">
        <header className="admin-shell__topbar">
          <div className="admin-shell__topbar-left">
            <button
              type="button"
              className="admin-shell__menu-btn"
              aria-label="Open navigation menu"
              aria-expanded={mobileOpen}
              onClick={() => setMobileOpen((o) => !o)}
            >
              <span /><span /><span />
            </button>
            <div>
              <p className="admin-shell__crumb">Golden Labs Admin</p>
              <h1 className="admin-shell__page-title">{activeLabel}</h1>
            </div>
          </div>
          <div className="admin-shell__topbar-right">
            <span className="admin-shell__wallet-pill" title={wallet}>
              {wallet ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : ""}
            </span>
            <button type="button" className="btn btn--ghost admin-shell__logout" onClick={onLogout}>
              Disconnect
            </button>
          </div>
        </header>

        <main className="admin-shell__content">{children}</main>
      </div>
    </div>
  );
}
