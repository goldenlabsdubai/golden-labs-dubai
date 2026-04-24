/**
 * Short-lived cache of last confirmed minted/trader state so ProtectedRoute does not
 * bounce the user (e.g. marketplace → mint → home) when GET /user/me briefly downgrades
 * state during MetaMask txs or RPC lag.
 *
 * Never overrides SUSPENDED — that is enforced before overlay.
 */
const KEY = "gl_trading_route_gate";
export const TRADING_ROUTE_GATE_TTL_MS = 20 * 60 * 1000;

function stateRank(s) {
  if (s === "ACTIVE_TRADER" || s === "MINTED") return 3;
  if (s === "SUBSCRIBED") return 2;
  if (s === "PROFILE_SET" || s === "REGISTERED" || s === "CONNECTED") return 1;
  return 0;
}

export function recordTradingGateIfEligible(user) {
  if (!user?.wallet) return;
  const w = String(user.wallet).toLowerCase();
  if (user.state === "MINTED" || user.state === "ACTIVE_TRADER") {
    try {
      sessionStorage.setItem(KEY, JSON.stringify({ wallet: w, state: user.state, ts: Date.now() }));
    } catch {
      /* ignore */
    }
  }
}

export function clearTradingRouteGate() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/**
 * @param {object | null} baseUser - current user from context/storage (must not be suspended)
 * @returns {object | null}
 */
export function withTradingGateOverlay(baseUser) {
  if (!baseUser || baseUser.state === "SUSPENDED") return baseUser;
  let cached;
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return baseUser;
    cached = JSON.parse(raw);
  } catch {
    return baseUser;
  }
  const w = String(baseUser.wallet || "").toLowerCase();
  if (!cached?.wallet || cached.wallet !== w) return baseUser;
  if (Date.now() - (cached.ts || 0) > TRADING_ROUTE_GATE_TTL_MS) return baseUser;
  if (cached.state !== "MINTED" && cached.state !== "ACTIVE_TRADER") return baseUser;
  if (stateRank(cached.state) > stateRank(baseUser.state)) {
    return { ...baseUser, state: cached.state };
  }
  return baseUser;
}
