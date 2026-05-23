import { Link, useLocation } from "react-router-dom";

/**
 * SPA navigation — keeps wagmi / JWT session warm (no full document reload).
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
    <Link to={to} className={cls} {...rest}>
      {children}
    </Link>
  );
}
