import { NavLink, useNavigate } from "react-router-dom";

/**
 * SPA navigation — keeps wagmi / JWT session warm (no full document reload).
 * NavLink + post-click URL sync so refresh stays on /marketplace, /dashboard, etc.
 */
export function AppRouteLink({ to, end, className, children, replace, onClick, ...rest }) {
  const navigate = useNavigate();

  const handleClick = (e) => {
    onClick?.(e);
    if (e.defaultPrevented) return;
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const path =
      typeof to === "string"
        ? to.split("?")[0].split("#")[0]
        : (to?.pathname || "/");
    queueMicrotask(() => {
      if (window.location.pathname !== path) {
        navigate(to, { replace: Boolean(replace) });
      }
    });
  };

  return (
    <NavLink to={to} end={end} replace={replace} className={className} onClick={handleClick} {...rest}>
      {children}
    </NavLink>
  );
}
