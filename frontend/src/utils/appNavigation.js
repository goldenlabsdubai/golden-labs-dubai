/**
 * Full URL navigation for top-level app routes. MetaMask (and some in-app browsers)
 * often keep the wrong path in the address bar with client-side history alone, which
 * breaks after wallet popups (restore/back shows the old URL).
 */
export function assignAppPath(path) {
  if (typeof window === "undefined") return;
  const p = path.startsWith("/") ? path : `/${path}`;
  window.location.assign(`${window.location.origin}${p}`);
}
