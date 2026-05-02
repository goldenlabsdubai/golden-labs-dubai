import { AppRouteLink } from "./AppRouteLink";
import { BRAND_LOGO_SRC } from "../config/brandAssets";

/**
 * Golden Labs wordmark + logo for top navs (landing, marketplace, dashboard, etc.).
 */
export function NavbarBrandLink({ to = "/", className = "" }) {
  return (
    <AppRouteLink to={to} className={className ? `navbar-brand ${className}`.trim() : "navbar-brand"}>
      <img src={BRAND_LOGO_SRC} alt="" className="navbar-brand__logo-img" decoding="async" />
      <span className="navbar-brand__wordmark">Golden Labs</span>
    </AppRouteLink>
  );
}
