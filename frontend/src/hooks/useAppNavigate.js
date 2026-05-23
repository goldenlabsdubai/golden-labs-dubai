import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { syncBrowserPath } from "../utils/appNavigation";

/** SPA navigation — always updates the browser URL (refresh stays on same page). */
export function useAppNavigate() {
  const navigate = useNavigate();
  return useCallback(
    (path, opts = {}) => {
      const p = path.startsWith("/") ? path : `/${path}`;
      const replace = Boolean(opts.replace);
      navigate(p, { replace });
      queueMicrotask(() => {
        if (window.location.pathname !== p) syncBrowserPath(p, replace);
      });
    },
    [navigate]
  );
}
