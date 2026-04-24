import { useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { canAccessTradingNav } from "../utils/tradingAccess";
import { AppRouteLink } from "./AppRouteLink";

function IconHome() {
  return (
    <svg className="app-mobile-nav__icon" width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 10.5L12 3l9 7.5V20a1.5 1.5 0 01-1.5 1.5h-4.5v-6H9v6H4.5A1.5 1.5 0 013 20v-9.5z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconMarketplace() {
  return (
    <svg className="app-mobile-nav__icon" width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 10.5V20h16v-9.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 8l2.5-5h13L21 8v2.5H3V8z" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 14h6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

function IconDashboard() {
  return (
    <svg className="app-mobile-nav__icon" width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1.25" stroke="currentColor" strokeWidth="1.75" />
      <rect x="14" y="3" width="7" height="7" rx="1.25" stroke="currentColor" strokeWidth="1.75" />
      <rect x="3" y="14" width="7" height="7" rx="1.25" stroke="currentColor" strokeWidth="1.75" />
      <rect x="14" y="14" width="7" height="7" rx="1.25" stroke="currentColor" strokeWidth="1.75" />
    </svg>
  );
}

function IconLeaderboard() {
  return (
    <svg className="app-mobile-nav__icon" width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M8 21h8M12 17v4M7 4h10v5a5 5 0 11-10 0V4z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M12 2v2" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

const tradingTabs = [
  { to: "/marketplace", label: "Marketplace", Icon: IconMarketplace },
  { to: "/dashboard", label: "Dashboard", Icon: IconDashboard },
  { to: "/leaderboard", label: "Leaderboard", Icon: IconLeaderboard },
];

function IconContinue() {
  return (
    <svg className="app-mobile-nav__icon" width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Bottom tab bar for small screens — gold theme. Hidden on profile setup & public user pages. */
export default function MobileBottomNav() {
  const { pathname } = useLocation();
  const { token, user } = useAuth();
  if (/^\/profile\/setup/.test(pathname)) return null;
  if (/^\/user\//.test(pathname)) return null;

  const tradingUnlocked = canAccessTradingNav(user);
  const onboard =
    token && user && !tradingUnlocked
      ? user.state === "SUBSCRIBED"
        ? { to: "/mint", label: "Mint", Icon: IconContinue }
        : { to: "/subscription", label: "Subscribe", Icon: IconContinue }
      : null;

  const tabs = [{ to: "/", end: true, label: "Home", Icon: IconHome }];
  if (onboard) tabs.push(onboard);
  if (tradingUnlocked) tabs.push(...tradingTabs);

  return (
    <nav className="app-mobile-nav" aria-label="Main navigation">
      {tabs.map(({ to, end, label, Icon }) => (
        <AppRouteLink
          key={to + (end ? "-root" : "")}
          to={to}
          end={Boolean(end)}
          className={({ isActive }) => `app-mobile-nav__link${isActive ? " app-mobile-nav__link--active" : ""}`}
        >
          <Icon />
          <span className="app-mobile-nav__label">{label}</span>
        </AppRouteLink>
      ))}
    </nav>
  );
}
