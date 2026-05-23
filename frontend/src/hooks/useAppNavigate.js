import { useCallback } from "react";
import { useNavigate } from "react-router-dom";

/** SPA navigation — always updates the browser URL (refresh stays on same page). */
export function useAppNavigate() {
  const navigate = useNavigate();
  return useCallback(
    (path, opts = {}) => {
      const p = path.startsWith("/") ? path : `/${path}`;
      navigate(p, { replace: Boolean(opts.replace) });
    },
    [navigate]
  );
}
