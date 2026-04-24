import { Link, useLocation } from "react-router-dom";

/**
 * Same as NavLink styling hooks but forces a real document navigation so the browser URL
 * matches the page (critical for MetaMask in-app browser + bfcache).
 */
export function AppRouteLink({ to, end, className, children, ...rest }) {
  const location = useLocation();
  let isActive = false;
  if (end) {
    isActive = location.pathname === to;
  } else if (to === "/") {
    isActive = location.pathname === "/";
  } else {
    isActive = location.pathname === to || location.pathname.startsWith(`${to}/`);
  }
  const cls = typeof className === "function" ? className({ isActive }) : className;

  return (
    <Link to={to} reloadDocument className={cls} {...rest}>
      {children}
    </Link>
  );
}
