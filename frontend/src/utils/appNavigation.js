/**
 * When the app has mounted inside React Router, we register `navigate` here so internal
 * moves preserve the SPA session (wagmi / AppKit stay warm). Without this, every
 * `assignAppPath` was a full `location.assign` reload — a common cause of `address`
 * staying null until manual “connect again” (WalletConnect flush + cold reconnect).
 *
 * Fallback remains full assign when no registered navigate (tests, edge loads).
 */
let spaNavigate = null;

/** @param {((to: string, opts?: { replace?: boolean }) => void) | null} navigate */
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
    spaNavigate(p, { replace: Boolean(opts.replace) });
    return;
  }
  window.location.assign(`${window.location.origin}${p}`);
}

const WALLET_TX_RETURN_KEY = "gl_wallet_tx_return";
const WALLET_TX_IN_FLIGHT_KEY = "gl_wallet_tx_in_flight";
const WALLET_TX_RETURN_TTL_MS = 15 * 60 * 1000;

/** Remember current route before a wallet popup (MM often reloads to `/`). */
export function rememberWalletTxReturnPath(pathname) {
  if (typeof window === "undefined") return;
  try {
    const path =
      pathname ||
      `${window.location.pathname || "/"}${window.location.search || ""}`;
    if (!path || path === "/") return;
    sessionStorage.setItem(
      WALLET_TX_RETURN_KEY,
      JSON.stringify({ path, ts: Date.now() })
    );
  } catch {
    /* ignore */
  }
}

export function clearWalletTxReturnPath() {
  try {
    sessionStorage.removeItem(WALLET_TX_RETURN_KEY);
  } catch {
    /* ignore */
  }
}

/** @returns {string | null} */
export function peekWalletTxReturnPath() {
  try {
    const raw = sessionStorage.getItem(WALLET_TX_RETURN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.path || Date.now() - (parsed.ts || 0) > WALLET_TX_RETURN_TTL_MS) {
      sessionStorage.removeItem(WALLET_TX_RETURN_KEY);
      return null;
    }
    return String(parsed.path);
  } catch {
    return null;
  }
}

/** Read and clear saved return path. */
export function consumeWalletTxReturnPath() {
  const path = peekWalletTxReturnPath();
  clearWalletTxReturnPath();
  return path;
}

export function markWalletTxInFlight() {
  try {
    sessionStorage.setItem(WALLET_TX_IN_FLIGHT_KEY, JSON.stringify({ ts: Date.now() }));
  } catch {
    /* ignore */
  }
}

export function clearWalletTxInFlight() {
  try {
    sessionStorage.removeItem(WALLET_TX_IN_FLIGHT_KEY);
  } catch {
    /* ignore */
  }
}

export function isWalletTxInFlight() {
  try {
    const raw = sessionStorage.getItem(WALLET_TX_IN_FLIGHT_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return Date.now() - (parsed.ts || 0) < WALLET_TX_RETURN_TTL_MS;
  } catch {
    return false;
  }
}

/** After wallet popup / bfcache reload, return user to the page they started on. */
export function restoreWalletTxReturnPathIfNeeded(currentPathname = "/") {
  const saved = peekWalletTxReturnPath();
  if (!saved) return false;
  const cur = currentPathname || "/";
  if (saved === cur) return false;
  const appPaths = ["/subscription", "/mint", "/marketplace", "/dashboard", "/leaderboard", "/profile"];
  if (appPaths.some((p) => cur === p || cur.startsWith(`${p}/`))) return false;
  if (cur !== "/" && !isWalletTxInFlight()) return false;
  consumeWalletTxReturnPath();
  assignAppPath(saved);
  return true;
}
