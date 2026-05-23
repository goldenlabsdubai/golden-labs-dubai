import { useEffect, useLayoutEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { registerSpaNavigate } from "../utils/appNavigation";

/**
 * Registers React Router `navigate` as early as possible so assignAppPath / CTAs
 * update the address bar (/subscription, /marketplace, …) without full reloads.
 */
export function AppNavigateProvider({ children }) {
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const { pathname, search } = useLocation();

  useLayoutEffect(() => {
    registerSpaNavigate((to, opts) => {
      navigateRef.current(to, { replace: Boolean(opts?.replace) });
    });
    return () => registerSpaNavigate(null);
  }, []);

  useEffect(() => {
    if (pathname && pathname !== "/") {
      try {
        sessionStorage.setItem("gl_router_last_path", `${pathname}${search || ""}`);
      } catch {
        /* ignore */
      }
    }
  }, [pathname, search]);

  return children;
}
