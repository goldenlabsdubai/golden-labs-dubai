/**
 * When the app has mounted inside React Router, we register `navigate` here so internal
 * moves preserve the SPA session (wagmi / AppKit stay warm). Without this, every
 * `assignAppPath` was a full `location.assign` reload — a common cause of `address`
 * staying null until manual “connect again” (WalletConnect flush + cold reconnect).
 *
 * Fallback remains full assign when no registered navigate (tests, edge loads).
 */
let spaNavigate = null;

/** @param {((to: string) => void) | null} navigate */
export function registerSpaNavigate(navigate) {
  spaNavigate = typeof navigate === "function" ? navigate : null;
}

/**
 * @param {string} path
 * @param {{ hard?: boolean }} [opts] — `hard: true` forces a full page load (rare)
 */
export function assignAppPath(path, opts = {}) {
  if (typeof window === "undefined") return;
  const p = path.startsWith("/") ? path : `/${path}`;
  if (!opts.hard && spaNavigate) {
    spaNavigate(p);
    return;
  }
  window.location.assign(`${window.location.origin}${p}`);
}
